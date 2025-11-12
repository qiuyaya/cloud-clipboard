import { Router } from "express";
import { shareService } from "../services/ShareService";
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
  fileId: z.string().uuid("Invalid file ID"),
  password: z.string().min(8).max(100).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

const router = Router();

/**
 * POST /api/share
 * Create a new share link
 */
router.post("/", rateLimitCreateShare, async (req, res) => {
  try {
    // Validate request body
    const validatedData = CreateShareSchema.parse(req.body);

    // TODO: In a real implementation, verify user authentication
    // const userId = req.user?.id;
    const userId = req.body.createdBy || "temp-user-id"; // Use provided userId or fallback

    // Create share link
    const share = await shareService.createShare({
      fileId: validatedData.fileId,
      createdBy: userId,
      ...(validatedData.password && { password: validatedData.password }),
      ...(validatedData.expiresInDays && { expiresInDays: validatedData.expiresInDays }),
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
        createdAt: share.createdAt.toISOString(),
        expiresAt: share.expiresAt.toISOString(),
        hasPassword: share.passwordHash !== null,
        accessCount: share.accessCount,
      },
    });
  } catch (error: unknown) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: error.issues.map((e) => e.message).join(", ") || "Invalid request data",
      });
    }

    // Handle password validation errors
    if (error.message.includes("Password validation failed")) {
      return res.status(400).json({
        success: false,
        error: "WEAK_PASSWORD",
        message:
          "Password must be at least 8 characters with uppercase, lowercase, number, and special character",
      });
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
router.get("/", rateLimitListShare, async (req, res) => {
  try {
    // TODO: In a real implementation, verify user authentication
    // const userId = req.user?.id;
    const userId = (req.query.userId as string) || "temp-user-id";

    const status = req.query.status as "active" | "expired" | "revoked" | "all" | undefined;
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
          return share.isActive && share.expiresAt > now;
        } else if (status === "expired") {
          return !share.isActive || share.expiresAt <= now;
        } else if (status === "revoked") {
          return !share.isActive;
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
      status:
        !share.isActive || share.expiresAt <= now
          ? share.isActive
            ? "expired"
            : "revoked"
          : "active",
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
router.get("/:shareId", rateLimitListShare, async (req, res) => {
  try {
    const { shareId } = req.params;

    // Get share details
    const share = shareService.getShareDetails(shareId);

    if (!share) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Share link not found",
      });
    }

    // TODO: In a real implementation, verify user authentication and ownership
    // const userId = req.user?.id;
    // if (share.createdBy !== userId) {
    //   return res.status(403).json({
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
        status: isExpired ? "expired" : share.isActive ? "active" : "revoked",
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
router.delete("/:shareId", rateLimitRevokeShare, async (req, res) => {
  try {
    const { shareId } = req.params;

    // TODO: In a real implementation, verify user authentication
    // const userId = req.user?.id;
    const userId = req.body.userId || "temp-user-id";

    // Check if share exists
    const share = shareService.getShareDetails(shareId);

    if (!share) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Share link not found",
      });
    }

    // Verify ownership
    if (share.createdBy !== userId) {
      return res.status(403).json({
        success: false,
        error: "FORBIDDEN",
        message: "You do not have permission to revoke this share",
      });
    }

    // Revoke the share
    const success = shareService.revokeShare(shareId, userId);

    if (!success) {
      return res.status(500).json({
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
 * GET /api/share/:shareId/download
 * Download a shared file (external access)
 */
router.get("/:shareId/download", rateLimitDownloadShare, async (req, res) => {
  try {
    const { shareId } = req.params;

    // Validate share
    const validation = shareService.validateShare(shareId);

    if (!validation.isValid) {
      // Log failed access attempt
      shareService.logAccess({
        shareId,
        ipAddress: req.ip || req.connection.remoteAddress || "unknown",
        userAgent: req.get("user-agent"),
        success: false,
        errorCode: validation.errorCode as any,
      });

      // Return 404 for invalid/expired links (as per clarification)
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Share link not found or expired",
      });
    }

    // For password-protected shares, check if password is provided
    if (validation.share!.passwordHash) {
      const authHeader = req.get("authorization");

      if (!authHeader || !authHeader.startsWith("Basic ")) {
        res.setHeader("WWW-Authenticate", 'Basic realm="Share Password Required"');

        // Log failed access attempt
        shareService.logAccess({
          shareId,
          ipAddress: req.ip || req.connection.remoteAddress || "unknown",
          userAgent: req.get("user-agent"),
          success: false,
          errorCode: "wrong_password",
        });

        return res.status(401).json({
          success: false,
          error: "AUTHENTICATION_REQUIRED",
          message: "Password required to access this share",
        });
      }

      // Extract and verify password from Basic Auth
      try {
        const base64Credentials = authHeader.split(" ")[1];
        const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
        const [username, password] = credentials.split(":");

        // In Basic Auth, the password is in the "password" field
        // We ignore the username part
        const isValid = await shareService.comparePassword(
          password || "",
          validation.share!.passwordHash!,
        );

        if (!isValid) {
          // Log failed access attempt
          shareService.logAccess({
            shareId,
            ipAddress: req.ip || req.connection.remoteAddress || "unknown",
            userAgent: req.get("user-agent"),
            success: false,
            errorCode: "wrong_password",
          });

          return res.status(401).json({
            success: false,
            error: "INVALID_CREDENTIALS",
            message: "Incorrect password",
          });
        }
      } catch (error) {
        // Log failed access attempt
        shareService.logAccess({
          shareId,
          ipAddress: req.ip || req.connection.remoteAddress || "unknown",
          userAgent: req.get("user-agent"),
          success: false,
          errorCode: "wrong_password",
        });

        return res.status(401).json({
          success: false,
          error: "INVALID_CREDENTIALS",
          message: "Invalid authentication format",
        });
      }
    }

    // Update access statistics
    validation.share.accessCount++;
    validation.share.lastAccessedAt = new Date();

    // Log successful access
    shareService.logAccess({
      shareId,
      ipAddress: req.ip || req.connection.remoteAddress || "unknown",
      userAgent: req.get("user-agent"),
      success: true,
      bytesTransferred: 0, // Would be actual file size in real implementation
    });

    // TODO: Stream actual file
    // In a real implementation:
    // 1. Get file path from fileManager using validation.share!.fileId
    // 2. Set appropriate headers (Content-Type, Content-Disposition)
    // 3. Stream the file

    // For now, return a success message
    res.status(200).json({
      success: true,
      message: "File streaming would happen here",
      shareId,
      // In real implementation, this would stream the actual file
    });
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to download file",
    });
  }
});

/**
 * GET /api/share/:shareId/access
 * Get access logs for a share
 */
router.get("/:shareId/access", rateLimitAccessLogs, async (req, res) => {
  try {
    const { shareId } = req.params;

    // Check if share exists
    const share = shareService.getShareDetails(shareId);

    if (!share) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Share link not found",
      });
    }

    // TODO: In a real implementation, verify user authentication and ownership
    // const userId = req.user?.id;
    // if (share.createdBy !== userId) {
    //   return res.status(403).json({
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

export default router;
