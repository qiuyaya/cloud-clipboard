import { Router, Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";
import { fileTypeFromFile } from "file-type";
import { shareService } from "../services/ShareService";
import { FileManager } from "../services/FileManager";
import { z } from "zod";
import {
  rateLimitCreateShare,
  rateLimitListShare,
  rateLimitRevokeShare,
  rateLimitAccessLogs,
  concurrentDownloadTracker,
} from "../middleware/rateLimiter";
import { getPublicUrl } from "../utils/url";

// Bandwidth tracking for rate limiting
class BandwidthTracker {
  private bandwidthMap: Map<string, { bytes: number; resetTime: number }> = new Map();

  checkAndIncrement(ip: string, bytes: number, windowMs: number, maxBytes: number): boolean {
    const now = Date.now();
    const data = this.bandwidthMap.get(ip);

    if (!data || now > data.resetTime) {
      // Reset or create new tracking
      this.bandwidthMap.set(ip, {
        bytes,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (data.bytes + bytes > maxBytes) {
      return false;
    }

    data.bytes += bytes;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [ip, data] of this.bandwidthMap.entries()) {
      if (now > data.resetTime) {
        this.bandwidthMap.delete(ip);
      }
    }
  }
}

const bandwidthTracker = new BandwidthTracker();

// Track active file streams to prevent memory exhaustion
class StreamTracker {
  private activeStreams: Set<NodeJS.ReadableStream> = new Set();
  private maxStreams: number;

  constructor(maxStreams: number = 100) {
    this.maxStreams = maxStreams;
  }

  canCreateStream(): boolean {
    return this.activeStreams.size < this.maxStreams;
  }

  addStream(stream: NodeJS.ReadableStream): void {
    this.activeStreams.add(stream);

    // Auto-cleanup when stream ends or errors
    const cleanup = () => {
      this.activeStreams.delete(stream);
    };

    stream.on("end", cleanup);
    stream.on("error", cleanup);
    stream.on("close", cleanup);
  }

  getActiveCount(): number {
    return this.activeStreams.size;
  }

  getMaxStreams(): number {
    return this.maxStreams;
  }
}

const streamTracker = new StreamTracker(parseInt(process.env.MAX_ACTIVE_FILE_STREAMS || "100"));

// Input validation middleware for shareId
export const validateShareId = (req: Request, res: Response, next: NextFunction): void => {
  const shareId = req.params.shareId;

  // Validate shareId format: only base62 characters (0-9, A-Z, a-z) and length 8-10
  if (!shareId || typeof shareId !== "string" || !/^[0-9A-Za-z]{8,10}$/.test(shareId)) {
    res.status(404).json({
      success: false,
      error: "NOT_FOUND",
      message: "The requested resource was not found",
    });
    return;
  }

  next();
};

// Uniform error response function
const sendErrorResponse = (res: Response, statusCode: number): void => {
  res.status(statusCode).json({
    success: false,
    error: "NOT_FOUND",
    message: "The requested resource was not found",
  });
};

// Validation schema for create share request
const CreateShareSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
  password: z.enum(["auto-generate"]).optional(),
});

// Export the download handler for public file routes
// The fileManager parameter is captured in closure and used for file retrieval
export const createShareDownloadHandler = (fileManager: FileManager) => {
  // fileManager is used in closure for file retrieval
  void fileManager;

  // Get configuration from environment
  const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "104857600"); // 100MB in bytes
  const DOWNLOAD_TIMEOUT = parseInt(process.env.DOWNLOAD_TIMEOUT || "30000"); // 30 seconds in ms

  return async (req: Request, res: Response): Promise<void> => {
    // Enhanced IP validation - support X-Forwarded-For header for proxies
    const getClientIP = (): string => {
      const xForwardedFor = req.headers["x-forwarded-for"];
      if (typeof xForwardedFor === "string" && xForwardedFor.trim() !== "") {
        // Handle comma-separated IPs, take the first one (client IP)
        const ips = xForwardedFor.split(",").map((ip) => ip.trim());
        return ips[0] || "unknown";
      }
      return req.ip || req.connection.remoteAddress || "unknown";
    };

    const clientIP = getClientIP();
    const shareId = req.params.shareId as string;

    // Cleanup function to decrement counters
    const cleanup = (): void => {
      concurrentDownloadTracker.decrement(clientIP);
      // Cleanup bandwidth tracker periodically
      if (Math.random() < 0.01) {
        // 1% chance to trigger cleanup
        bandwidthTracker.cleanup();
      }
    };

    try {
      // Set timeout to prevent slowloris attacks
      res.setTimeout(DOWNLOAD_TIMEOUT, () => {
        console.warn(`Download timeout for shareId: ${shareId} from IP: ${clientIP}`);
        cleanup();
        if (!res.headersSent) {
          sendErrorResponse(res, 408);
        }
      });

      // Check concurrent download limit
      if (!concurrentDownloadTracker.increment(clientIP)) {
        console.warn(`Too many concurrent downloads from IP: ${clientIP}`);
        sendErrorResponse(res, 429);
        return;
      }

      // Validate share
      const validation = shareService.validateShare(shareId);

      if (!validation.isValid || !validation.share) {
        cleanup();
        sendErrorResponse(res, 404);
        return;
      }

      // For password-protected shares, check if password is provided
      if (validation.share.passwordHash) {
        const authHeader = req.get("authorization");

        if (!authHeader || !authHeader.startsWith("Basic ")) {
          cleanup();

          // Log failed access attempt
          shareService.logAccess({
            shareId,
            ipAddress: clientIP,
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "wrong_password",
          });

          sendErrorResponse(res, 401);
          return;
        }

        // Extract and verify password from Basic Auth
        try {
          const base64Credentials = authHeader.split(" ")[1];

          if (!base64Credentials) {
            cleanup();
            sendErrorResponse(res, 401);
            return;
          }

          const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
          const [_username, password] = credentials.split(":");

          if (!password) {
            cleanup();
            sendErrorResponse(res, 401);
            return;
          }

          // Verify password
          if (!validation.share.passwordHash) {
            cleanup();
            sendErrorResponse(res, 401);
            return;
          }

          const isPasswordValid = await shareService.comparePassword(
            password,
            validation.share.passwordHash,
          );

          if (!isPasswordValid) {
            cleanup();

            // Log failed access attempt
            shareService.logAccess({
              shareId,
              ipAddress: clientIP,
              userAgent: req.get("user-agent") || "unknown",
              success: false,
              errorCode: "wrong_password",
            });

            sendErrorResponse(res, 401);
            return;
          }
        } catch (authError) {
          console.error("Authentication error:", authError);
          cleanup();
          sendErrorResponse(res, 401);
          return;
        }
      }

      // Get file from FileManager
      const fileRecord = await fileManager.getFile(validation.share.fileId);

      if (!fileRecord) {
        cleanup();

        // Log failed access attempt
        shareService.logAccess({
          shareId,
          ipAddress: clientIP,
          userAgent: req.get("user-agent") || "unknown",
          success: false,
          errorCode: "file_not_found",
        });

        sendErrorResponse(res, 404);
        return;
      }

      // Enhanced file access control - validate file path and check for symlink/hardlink attacks
      try {
        const allowedUploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads");
        const normalizedPath = path.normalize(fileRecord.path);
        const normalizedAllowedDir = path.normalize(allowedUploadDir);

        // Ensure the file path is within the allowed directory (prevent path traversal)
        if (!normalizedPath.startsWith(normalizedAllowedDir)) {
          console.error(`Blocked path traversal attempt: ${fileRecord.path}`);
          cleanup();

          shareService.logAccess({
            shareId,
            ipAddress: clientIP,
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "file_not_found",
          });

          sendErrorResponse(res, 404);
          return;
        }

        // Check if file still exists on disk
        if (!fs.existsSync(fileRecord.path)) {
          console.error(`File not found on disk: ${fileRecord.path}`);
          cleanup();

          shareService.logAccess({
            shareId,
            ipAddress: clientIP,
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "file_not_found",
          });

          sendErrorResponse(res, 404);
          return;
        }

        // Security check: Detect and block symbolic links
        const fileStats = fs.lstatSync(fileRecord.path);
        if (fileStats.isSymbolicLink()) {
          console.error(`Blocked symlink attack: ${fileRecord.path}`);
          cleanup();

          shareService.logAccess({
            shareId,
            ipAddress: clientIP,
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "file_not_found",
          });

          sendErrorResponse(res, 404);
          return;
        }

        // Security check: Detect potential hardlink attacks
        // Hardlinks with nlink > 1 might indicate attempts to access other files
        if (fileStats.nlink > 1) {
          console.error(
            `Potential hardlink attack detected: ${fileRecord.path}, nlink=${fileStats.nlink}`,
          );
          cleanup();

          shareService.logAccess({
            shareId,
            ipAddress: clientIP,
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "file_not_found",
          });

          sendErrorResponse(res, 404);
          return;
        }
      } catch (pathError) {
        console.error("Path validation error:", pathError);
        cleanup();
        sendErrorResponse(res, 404);
        return;
      }

      // Check file size against configured limit
      if (fileRecord.size > MAX_FILE_SIZE) {
        console.warn(
          `File size exceeds limit: ${fileRecord.size} > ${MAX_FILE_SIZE} for shareId: ${shareId}`,
        );
        cleanup();

        shareService.logAccess({
          shareId,
          ipAddress: clientIP,
          userAgent: req.get("user-agent") || "unknown",
          success: false,
          errorCode: "file_not_found",
        });

        sendErrorResponse(res, 404);
        return;
      }

      // Bandwidth rate limiting: max bytes = MAX_FILE_SIZE * 10
      const BANDWINDOW_WINDOW_MS = 60 * 1000; // 1 minute window
      const MAX_BANDWIDTH_BYTES = MAX_FILE_SIZE * 10;

      if (
        !bandwidthTracker.checkAndIncrement(
          clientIP,
          fileRecord.size,
          BANDWINDOW_WINDOW_MS,
          MAX_BANDWIDTH_BYTES,
        )
      ) {
        console.warn(
          `Bandwidth limit exceeded for IP: ${clientIP}. Attempted to download ${fileRecord.size} bytes`,
        );
        cleanup();

        shareService.logAccess({
          shareId,
          ipAddress: clientIP,
          userAgent: req.get("user-agent") || "unknown",
          success: false,
          errorCode: "bandwidth_limit_exceeded",
        });

        sendErrorResponse(res, 429);
        return;
      }

      // File type validation using file-type library
      let detectedMimeType: string | null = null;
      let detectedExt: string | null = null;

      try {
        const fileTypeResult = await fileTypeFromFile(fileRecord.path);

        if (fileTypeResult) {
          detectedMimeType = fileTypeResult.mime;
          detectedExt = fileTypeResult.ext;
          console.log(
            `Detected file type for ${fileRecord.filename}: ${detectedMimeType} (${detectedExt})`,
          );
        } else {
          console.warn(
            `Could not detect file type for ${fileRecord.filename}, falling back to extension-based detection`,
          );
        }
      } catch (typeError) {
        console.error("Error detecting file type:", typeError);
        // Continue with extension-based detection as fallback
      }

      // Verify the detected file type matches allowed types
      const getMimeTypeSafe = (filename: string, detectedMime?: string | null): string => {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: { [key: string]: string } = {
          ".txt": "text/plain",
          ".pdf": "application/pdf",
          ".doc": "application/msword",
          ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".xls": "application/vnd.ms-excel",
          ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ".ppt": "application/vnd.ms-powerpoint",
          ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".webp": "image/webp",
          ".zip": "application/zip",
          ".rar": "application/vnd.rar",
          ".7z": "application/x-7z-compressed",
          ".tar": "application/x-tar",
          ".gz": "application/gzip",
          ".mp3": "audio/mpeg",
          ".mp4": "video/mp4",
          ".avi": "video/x-msvideo",
          ".mov": "video/quicktime",
          ".wmv": "video/x-ms-wmv",
          ".flv": "video/x-flv",
          ".webm": "video/webm",
          ".json": "application/json",
          ".xml": "application/xml",
          ".csv": "text/csv",
        };

        return detectedMime || mimeTypes[ext] || "application/octet-stream";
      };

      // Log successful access with actual file size
      shareService.logAccess({
        shareId,
        ipAddress: clientIP,
        userAgent: req.get("user-agent") || "unknown",
        success: true,
        bytesTransferred: fileRecord.size,
      });

      // Check stream limit before creating read stream
      if (!streamTracker.canCreateStream()) {
        console.warn(
          `Stream limit exceeded (${streamTracker.getActiveCount()}/${streamTracker.getMaxStreams()}) for IP: ${clientIP}`,
        );
        cleanup();

        shareService.logAccess({
          shareId,
          ipAddress: clientIP,
          userAgent: req.get("user-agent") || "unknown",
          success: false,
          errorCode: "resource_unavailable",
        });

        sendErrorResponse(res, 503);
        return;
      }

      // Prevent race conditions by using file descriptor-based access
      // This ensures the file cannot be replaced between validation and reading
      let fileDescriptor: number | null = null;
      try {
        // Open file with file descriptor to prevent TOCTOU (Time-of-check-time-of-use) race condition
        fileDescriptor = fs.openSync(fileRecord.path, "r");

        // Re-verify file stats after opening (extra security layer)
        const stats = fs.fstatSync(fileDescriptor);
        if (stats.nlink > 1) {
          // Hardlink check after opening (prevents race condition)
          throw new Error(`Potential hardlink attack: nlink=${stats.nlink}`);
        }

        if (stats.size !== fileRecord.size) {
          // File size mismatch - potential attack
          throw new Error(`File size mismatch: expected ${fileRecord.size}, got ${stats.size}`);
        }
      } catch (raceConditionError) {
        if (fileDescriptor !== null) {
          try {
            fs.closeSync(fileDescriptor);
          } catch (closeError) {
            console.error("Error closing file descriptor:", closeError);
          }
        }

        console.error("Race condition or security violation detected:", raceConditionError);
        cleanup();

        shareService.logAccess({
          shareId,
          ipAddress: clientIP,
          userAgent: req.get("user-agent") || "unknown",
          success: false,
          errorCode: "file_not_found",
        });

        sendErrorResponse(res, 404);
        return;
      }

      // Stream the file using fs.createReadStream to prevent memory exhaustion
      // Set response headers
      const mimeType = getMimeTypeSafe(fileRecord.filename, detectedMimeType);
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", fileRecord.size.toString());
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(fileRecord.filename)}"`,
      );
      res.setHeader("Cache-Control", "private, no-transform, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");

      // Create read stream from file descriptor (prevents race conditions)
      const readStream = fs.createReadStream("", { fd: fileDescriptor, autoClose: true });

      // Add stream to tracker for memory management
      streamTracker.addStream(readStream);

      // Ensure file descriptor is closed when stream ends
      readStream.on("end", () => {
        console.log(
          `File streamed successfully: ${fileRecord.filename} (${fileRecord.size} bytes)`,
        );
        cleanup();
      });

      readStream.on("error", (err) => {
        console.error("Error reading file stream:", err);
        cleanup();
        if (!res.headersSent) {
          sendErrorResponse(res, 500);
        } else {
          res.end();
        }
      });

      // Handle response close event
      res.on("close", () => {
        if (!res.writableEnded) {
          readStream.destroy();
          cleanup();
        }
      });

      // Pipe the stream to response
      readStream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      cleanup();
      if (!res.headersSent) {
        sendErrorResponse(res, 500);
      }
    }
  };
};

export const createShareRoutes = (fileManager: FileManager): Router => {
  // fileManager parameter is for API compatibility but not used in this route group
  void fileManager;
  const router = Router();

  /**
   * POST /api/share
   * Create a new share link
   */
  router.post("/", rateLimitCreateShare, async (req, res): Promise<void> => {
    try {
      // Validate request body
      const validatedData = CreateShareSchema.parse(req.body);

      // TODO: In a real implementation, verify user authentication
      // const userId = req.user?.id;
      const userId = req.body.createdBy || "temp-user-id"; // Use provided userId or fallback

      // Create share link
      const shouldUsePassword = !!validatedData.password; // If password field is present
      const share = await shareService.createShare({
        fileId: validatedData.fileId,
        createdBy: userId,
        ...(validatedData.expiresInDays && { expiresInDays: validatedData.expiresInDays }),
        ...(shouldUsePassword && { enablePassword: true }),
      });

      // Return success response
      res.status(201).json({
        success: true,
        message: "Share link created successfully",
        data: {
          shareId: share.shareId,
          fileId: share.fileId,
          createdBy: share.createdBy,
          url: getPublicUrl(req, `/public/file/${share.shareId}`),
          ...(share.password && { password: share.password }),
          createdAt: share.createdAt.toISOString(),
          expiresAt: share.expiresAt.toISOString(),
          hasPassword: !!share.passwordHash,
          accessCount: share.accessCount,
        },
      });
    } catch (error: unknown) {
      // Handle validation errors
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR",
          message: error.issues.map((e) => e.message).join(", ") || "Invalid request data",
        });
        return;
      }

      // Log error
      console.error("Error creating share:", error);

      // Return generic error
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Failed to create share link",
      });
    }
  });

  /**
   * GET /api/share
   * List user's share links
   */
  router.get("/", rateLimitListShare, async (req, res): Promise<void> => {
    try {
      // TODO: In a real implementation, verify user authentication
      // const userId = req.user?.id;
      const userId = (req.query.userId as string) || "temp-user-id";

      const status = req.query.status as "active" | "expired" | "all" | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      // Get all user's shares
      const allShares = shareService.getUserShares(userId);

      // Filter by status if specified
      const now = new Date();
      let filteredShares = allShares;

      if (status && status !== "all") {
        filteredShares = allShares.filter((share) => {
          if (status === "active") {
            // Active: isActive is true AND not expired
            return share.isActive && share.expiresAt > now;
          } else if (status === "expired") {
            // Expired: not active OR expired (expiresAt <= now)
            return !share.isActive || share.expiresAt <= now;
          }
          return true;
        });
      }

      // Apply pagination
      const total = filteredShares.length;
      const paginatedShares =
        offset || limit
          ? filteredShares.slice(offset || 0, (offset || 0) + (limit || 50))
          : filteredShares;

      // Format response
      const shares = paginatedShares.map((share) => ({
        shareId: share.shareId,
        originalFilename: share.fileId, // Would get from file service in real implementation
        fileSize: 0, // Would get from file service in real implementation
        createdAt: share.createdAt.toISOString(),
        expiresAt: share.expiresAt.toISOString(),
        status: share.isActive && share.expiresAt > now ? "active" : "expired",
        accessCount: share.accessCount,
        hasPassword: share.passwordHash !== null,
      }));

      res.status(200).json({
        success: true,
        data: {
          shares,
          total,
          limit: limit || 50,
          offset: offset || 0,
        },
      });
    } catch (error) {
      console.error("Error listing shares:", error);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Failed to list share links",
      });
    }
  });

  /**
   * GET /api/share/:shareId
   * Get share link details
   */
  router.get("/:shareId", rateLimitListShare, async (req, res): Promise<void> => {
    try {
      const shareId = req.params.shareId as string;

      // Get share details
      const share = shareService.getShareDetails(shareId);

      if (!share) {
        res.status(404).json({
          success: false,
          error: "NOT_FOUND",
          message: "Share link not found",
        });
        return;
      }

      // TODO: In a real implementation, verify user authentication and ownership
      // const userId = req.user?.id;
      // if (share.createdBy !== userId) {
      //   res.status(403).json({
      //     success: false,
      //     error: 'FORBIDDEN',
      //     message: 'You do not have permission to view this share',
      //   });
      // }

      const now = new Date();
      const isExpired = !share.isActive || share.expiresAt <= now;

      // Format response
      const response = {
        success: true,
        data: {
          shareId: share.shareId,
          fileId: share.fileId,
          createdAt: share.createdAt.toISOString(),
          expiresAt: share.expiresAt.toISOString(),
          isActive: share.isActive,
          isExpired,
          accessCount: share.accessCount,
          lastAccessedAt: share.lastAccessedAt?.toISOString() || null,
          createdBy: share.createdBy,
          hasPassword: share.passwordHash !== null,
          status: isExpired ? "expired" : "active",
          // In a real implementation, would include:
          // originalFilename: string,
          // fileSize: number,
          // mimeType: string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Error getting share details:", error);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Failed to get share details",
      });
    }
  });

  /**
   * DELETE /api/share/:shareId
   * Revoke a share link
   */
  router.delete("/:shareId", rateLimitRevokeShare, async (req, res): Promise<void> => {
    try {
      const shareId = req.params.shareId as string;

      // TODO: In a real implementation, verify user authentication
      // const userId = req.user?.id;
      const userId = req.body.userId || "temp-user-id";

      // Check if share exists
      const share = shareService.getShareDetails(shareId);

      if (!share) {
        res.status(404).json({
          success: false,
          error: "NOT_FOUND",
          message: "Share link not found",
        });
        return;
      }

      // Verify ownership
      if (share.createdBy !== userId) {
        res.status(403).json({
          success: false,
          error: "FORBIDDEN",
          message: "You do not have permission to revoke this share",
        });
      }

      // Revoke the share
      const success = shareService.revokeShare(shareId, userId);

      if (!success) {
        res.status(500).json({
          success: false,
          error: "INTERNAL_ERROR",
          message: "Failed to revoke share",
        });
      }

      res.status(200).json({
        success: true,
        message: "Share link revoked successfully",
      });
    } catch (error) {
      console.error("Error revoking share:", error);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Failed to revoke share link",
      });
    }
  });

  /**
   * POST /api/share/:shareId/permanent-delete
   * Permanently delete a share link
   */
  router.post(
    "/:shareId/permanent-delete",
    rateLimitRevokeShare,
    async (req, res): Promise<void> => {
      try {
        const shareId = req.params.shareId as string;

        // TODO: In a real implementation, verify user authentication
        // const userId = req.user?.id;
        const userId = req.body.userId || "temp-user-id";

        // Check if share exists
        const share = shareService.getShareDetails(shareId);

        if (!share) {
          res.status(404).json({
            success: false,
            error: "NOT_FOUND",
            message: "Share link not found",
          });
          return;
        }

        // Verify ownership
        if (share.createdBy !== userId) {
          res.status(403).json({
            success: false,
            error: "FORBIDDEN",
            message: "You do not have permission to delete this share",
          });
        }

        // Permanently delete the share
        const success = shareService.deleteShare(shareId, userId);

        if (!success) {
          res.status(500).json({
            success: false,
            error: "INTERNAL_ERROR",
            message: "Failed to delete share",
          });
          return;
        }

        res.status(200).json({
          success: true,
          message: "Share link permanently deleted",
        });
      } catch (error) {
        console.error("Error deleting share:", error);
        res.status(500).json({
          success: false,
          error: "INTERNAL_ERROR",
          message: "Failed to permanently delete share link",
        });
      }
    },
  );

  /**
   * GET /api/share/:shareId/access
   * Get access logs for a share
   */
  router.get("/:shareId/access", rateLimitAccessLogs, async (req, res): Promise<void> => {
    try {
      const shareId = req.params.shareId as string;

      // Check if share exists
      const share = shareService.getShareDetails(shareId);

      if (!share) {
        res.status(404).json({
          success: false,
          error: "NOT_FOUND",
          message: "Share link not found",
        });
        return;
      }

      // TODO: In a real implementation, verify user authentication and ownership
      // const userId = req.user?.id;
      // if (share.createdBy !== userId) {
      //   res.status(403).json({
      //     success: false,
      //     error: 'FORBIDDEN',
      //     message: 'You do not have permission to view access logs',
      //   });
      // }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      // Get access logs
      const logs = shareService.getAccessLogs(shareId, limit);

      // Format response
      const formattedLogs = logs.map((log) => ({
        timestamp: log.timestamp.toISOString(),
        ipAddress: log.ipAddress,
        userAgent: log.userAgent || null,
        success: log.success,
        errorCode: log.errorCode || null,
        bytesTransferred: log.bytesTransferred || 0,
      }));

      res.status(200).json({
        success: true,
        data: {
          logs: formattedLogs,
          total: logs.length,
        },
      });
    } catch (error) {
      console.error("Error getting access logs:", error);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Failed to get access logs",
      });
    }
  });

  return router;
};
