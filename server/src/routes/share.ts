import { Router } from "express";
import { shareService } from "../services/ShareService";
import { FileManager } from "../services/FileManager";
import { z } from "zod";
import {
  rateLimitCreateShare,
  rateLimitDownloadShare,
  rateLimitListShare,
  rateLimitRevokeShare,
  rateLimitAccessLogs,
} from "../middleware/rateLimiter";

// Validation schema for create share request
const CreateShareSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
  password: z.enum(["auto-generate"]).optional(),
});

export const createShareRoutes = (fileManager: FileManager): Router => {
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
          url: `${req.protocol}://${req.get("host")}/api/share/${share.shareId}/download`,
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
   * GET /api/share/:shareId/download
   * Download a shared file (external access)
   */
  router.get("/:shareId/download", rateLimitDownloadShare, async (req, res): Promise<void> => {
    try {
      const shareId = req.params.shareId as string;

      // Validate share
      const validation = shareService.validateShare(shareId);

      if (!validation.isValid || !validation.share) {
        // Return 404 for invalid/expired links
        res.status(404).json({
          success: false,
          error: "NOT_FOUND",
          message: "Share link not found or expired",
        });
        return;
      }

      // For password-protected shares, check if password is provided
      if (validation.share.passwordHash) {
        const authHeader = req.get("authorization");

        if (!authHeader || !authHeader.startsWith("Basic ")) {
          res.setHeader("WWW-Authenticate", 'Basic realm="Share Password Required"');

          // Log failed access attempt
          shareService.logAccess({
            shareId,
            ipAddress: req.ip || req.connection.remoteAddress || "unknown",
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "wrong_password",
          });

          res.status(401).json({
            success: false,
            error: "AUTHENTICATION_REQUIRED",
            message: "Password required to access this share",
          });
          return;
        }

        // Extract and verify password from Basic Auth
        try {
          const base64Credentials = authHeader!.split(" ")[1];
          if (!base64Credentials) {
            throw new Error("Invalid auth format");
          }
          const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
          const [, password] = credentials.split(":");

          // In Basic Auth, the password is in the "password" field
          // We ignore the username part
          if (!validation.share) {
            throw new Error("Share not found");
          }
          const isValid = await shareService.comparePassword(
            password || "",
            validation.share.passwordHash!,
          );

          if (!isValid) {
            // Log failed access attempt
            shareService.logAccess({
              shareId,
              ipAddress: req.ip || req.connection.remoteAddress || "unknown",
              userAgent: req.get("user-agent") || "unknown",
              success: false,
              errorCode: "wrong_password",
            });

            res.status(401).json({
              success: false,
              error: "INVALID_CREDENTIALS",
              message: "Incorrect password",
            });
            return;
          }
        } catch (error) {
          // Log failed access attempt
          shareService.logAccess({
            shareId,
            ipAddress: req.ip || req.connection.remoteAddress || "unknown",
            userAgent: req.get("user-agent") || "unknown",
            success: false,
            errorCode: "wrong_password",
          });

          res.status(401).json({
            success: false,
            error: "INVALID_CREDENTIALS",
            message: "Invalid authentication format",
          });
          return;
        }
      }

      // Update access statistics
      if (validation.share) {
        validation.share.accessCount++;
        validation.share.lastAccessedAt = new Date();
      }

      // Get file from fileManager using the fileId from share
      const fileRecord = fileManager.getFile(validation.share!.fileId);

      if (!fileRecord) {
        // Log failed access attempt
        shareService.logAccess({
          shareId,
          ipAddress: req.ip || req.connection.remoteAddress || "unknown",
          userAgent: req.get("user-agent") || "unknown",
          success: false,
          errorCode: "file_not_found",
        });

        // Return 404 for missing files (but after logging)
        res.status(404).json({
          success: false,
          error: "FILE_NOT_FOUND",
          message: "File not found on server (may have been deleted)",
        });
        return;
      }

      // Log successful access with actual file size
      shareService.logAccess({
        shareId,
        ipAddress: req.ip || req.connection.remoteAddress || "unknown",
        userAgent: req.get("user-agent") || "unknown",
        success: true,
        bytesTransferred: fileRecord.size,
      });

      // Stream the file using res.download
      // res.download automatically sets:
      // - Content-Disposition: attachment with original filename
      // - Content-Type: based on file extension
      // - Content-Length: file size
      res.download(fileRecord.path, fileRecord.filename, (err) => {
        if (err) {
          console.error("Error streaming file:", err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "DOWNLOAD_ERROR",
              message: "Failed to download file",
            });
          }
        }
      });
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "INTERNAL_ERROR",
          message: "Failed to download file",
        });
      }
    }
  });

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
