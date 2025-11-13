import bcrypt from "bcryptjs";
import { generateShareId, validatePassword } from "@cloud-clipboard/shared";
import type { ShareLink as IShareLink } from "@cloud-clipboard/shared";

/**
 * ShareService - Manages external file sharing functionality
 * Handles share link creation, validation, streaming, and access logging
 */

export type ShareLink = IShareLink & {
  password?: string; // Plain text password for display only
};

export interface AccessLog {
  shareId: string;
  timestamp: Date;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
  errorCode?:
    | "expired"
    | "invalid"
    | "wrong_password"
    | "file_not_found"
    | "bandwidth_limit_exceeded"
    | "resource_unavailable";
  bytesTransferred?: number;
}

export class ShareService {
  private shares: Map<string, ShareLink> = new Map();
  private accessLogs: Map<string, AccessLog[]> = new Map();

  /**
   * Generate a random 6-character password
   */
  private generateRandomPassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 6; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Create a new share link with optional auto-generated password
   */
  async createShare(params: {
    fileId: string;
    createdBy: string;
    expiresInDays?: number;
    enablePassword?: boolean;
  }): Promise<ShareLink> {
    const { fileId, createdBy, expiresInDays = 7, enablePassword = false } = params;

    // Generate unique share ID
    const shareId = generateShareId();

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create share link
    const share: ShareLink = {
      shareId,
      fileId,
      createdAt: new Date(),
      expiresAt,
      passwordHash: null, // Will be set if password is enabled
      accessCount: 0,
      lastAccessedAt: null,
      isActive: true,
      createdBy,
    };

    // Generate password if enabled
    let password: string | undefined = undefined;
    if (enablePassword) {
      password = this.generateRandomPassword();
      share.passwordHash = await this.hashPassword(password);
    }

    // Store share link
    this.shares.set(shareId, share);

    // Return share with the plain password for display (if generated)
    return password ? { ...share, password } : share;
  }

  /**
   * Validate a share link
   */
  validateShare(shareId: string): {
    isValid: boolean;
    share?: ShareLink;
    errorCode?: string;
  } {
    const share = this.shares.get(shareId);

    if (!share) {
      return {
        isValid: false,
        errorCode: "invalid",
      };
    }

    // Check if share is active
    if (!share.isActive) {
      return {
        isValid: false,
        share,
        errorCode: "invalid",
      };
    }

    // Check if share has expired
    if (new Date() > share.expiresAt) {
      share.isActive = false; // Mark as inactive
      return {
        isValid: false,
        share,
        errorCode: "expired",
      };
    }

    return {
      isValid: true,
      share,
    };
  }

  /**
   * Stream a file for download
   * NOTE: This is a placeholder implementation
   * In a real implementation, you would:
   * 1. Get the file path from the fileId
   * 2. Stream the file from disk
   * 3. Set appropriate headers (Content-Type, Content-Disposition)
   */
  async streamFile(shareId: string, res: any): Promise<void> {
    const validation = this.validateShare(shareId);

    if (!validation.isValid || !validation.share) {
      throw new Error(`Share validation failed: ${validation.errorCode}`);
    }

    // Update access statistics
    validation.share.accessCount++;
    validation.share.lastAccessedAt = new Date();

    // Placeholder: In a real implementation, you would:
    // const filePath = fileManager.getFilePath(validation.share.fileId);
    // const fileStream = fs.createReadStream(filePath);
    // res.setHeader('Content-Type', mimeType);
    // res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
    // fileStream.pipe(res);

    // For now, just send a success response
    res.status(200).json({
      success: true,
      message: "File streaming would happen here",
      shareId,
    });
  }

  /**
   * Log access attempt
   */
  logAccess(params: {
    shareId: string;
    ipAddress: string;
    userAgent?: string;
    success: boolean;
    errorCode?: AccessLog["errorCode"];
    bytesTransferred?: number;
  }): void {
    const { shareId, ipAddress, userAgent, success, errorCode, bytesTransferred } = params;

    const log: AccessLog = {
      shareId,
      timestamp: new Date(),
      ipAddress,
      ...(userAgent && { userAgent }),
      success,
      ...(errorCode && { errorCode }),
      ...(bytesTransferred !== undefined && { bytesTransferred }),
    };

    // Get or create log array for this share
    if (!this.accessLogs.has(shareId)) {
      this.accessLogs.set(shareId, []);
    }

    this.accessLogs.get(shareId)!.push(log);
  }

  /**
   * Cleanup expired shares and old logs
   */
  cleanup(): void {
    const now = new Date();

    // Remove expired shares
    for (const [shareId, share] of this.shares.entries()) {
      if (!share.isActive || now > share.expiresAt) {
        share.isActive = false;
        this.shares.delete(shareId);
      }
    }

    // Remove logs older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const [shareId, logs] of this.accessLogs.entries()) {
      const filteredLogs = logs.filter((log) => log.timestamp > thirtyDaysAgo);

      if (filteredLogs.length === 0) {
        this.accessLogs.delete(shareId);
      } else {
        this.accessLogs.set(shareId, filteredLogs);
      }
    }
  }

  /**
   * Get shares by user
   */
  getUserShares(userId: string): ShareLink[] {
    return Array.from(this.shares.values()).filter((share) => share.createdBy === userId);
  }

  /**
   * Get share details
   */
  getShareDetails(shareId: string): ShareLink | null {
    return this.shares.get(shareId) || null;
  }

  /**
   * Revoke a share link
   */
  revokeShare(shareId: string, userId: string): boolean {
    const share = this.shares.get(shareId);

    if (!share) {
      return false;
    }

    // Check if user owns this share
    if (share.createdBy !== userId) {
      return false;
    }

    share.isActive = false;
    return true;
  }

  /**
   * Permanently delete a share link
   */
  deleteShare(shareId: string, userId: string): boolean {
    const share = this.shares.get(shareId);

    if (!share) {
      return false;
    }

    // Check if user owns this share
    if (share.createdBy !== userId) {
      return false;
    }

    // Delete share and its access logs
    this.shares.delete(shareId);
    this.accessLogs.delete(shareId);
    return true;
  }

  /**
   * Get access logs for a share
   */
  getAccessLogs(shareId: string, limit?: number): AccessLog[] {
    const logs = this.accessLogs.get(shareId) || [];

    if (limit) {
      return logs.slice(0, limit);
    }

    return logs;
  }

  /**
   * Validate password complexity
   */
  validatePassword(password: string): { isValid: boolean; errors?: string[] } {
    return validatePassword(password);
  }

  /**
   * Hash password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  /**
   * Compare password with hash
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

// Export singleton instance
export const shareService = new ShareService();
