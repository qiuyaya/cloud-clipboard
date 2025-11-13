import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShareService, shareService } from "../../src/services/ShareService";
import bcrypt from "bcryptjs";

describe("ShareService", () => {
  let service: ShareService;

  beforeEach(() => {
    service = new ShareService();
    // Clear all shares and logs before each test
    vi.clearAllMocks();
  });

  describe("createShare", () => {
    it("should create a share link without password by default", async () => {
      const result = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      expect(result.shareId).toBeDefined();
      expect(result.fileId).toBe("file-123");
      expect(result.createdBy).toBe("user-456");
      expect(result.passwordHash).toBeNull();
      expect(result.password).toBeUndefined();
      expect(result.isActive).toBe(true);
      expect(result.accessCount).toBe(0);
      expect(result.lastAccessedAt).toBeNull();
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("should create a share link with auto-generated password when enabled", async () => {
      const result = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
        enablePassword: true,
      });

      expect(result.shareId).toBeDefined();
      expect(result.fileId).toBe("file-123");
      expect(result.passwordHash).toBeDefined();
      expect(result.passwordHash).not.toBeNull();
      expect(result.password).toBeDefined();
      expect(result.password.length).toBe(6);
      // Verify password format (alphanumeric, no confusing characters)
      expect(result.password).toMatch(/^[A-Za-z0-9]{6}$/);
    });

    it("should create a share link with custom expiration", async () => {
      const result = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
        expiresInDays: 14,
      });

      const now = new Date();
      const expectedExpiry = new Date();
      expectedExpiry.setDate(expectedExpiry.getDate() + 14);

      // Check that expiry is approximately 14 days from now (within 1 second tolerance)
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
        now.getTime() + 13 * 24 * 60 * 60 * 1000,
      );
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
        now.getTime() + 15 * 24 * 60 * 60 * 1000,
      );
    });

    it("should generate unique passwords for multiple shares", async () => {
      const share1 = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });
      const share2 = await service.createShare({
        fileId: "file-456",
        createdBy: "user-456",
      });

      expect(share1.shareId).not.toBe(share2.shareId);
      expect(share1.password).not.toBe(share2.password);
    });

    it("should generate unique share IDs", async () => {
      const share1 = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });
      const share2 = await service.createShare({
        fileId: "file-456",
        createdBy: "user-456",
      });

      expect(share1.shareId).not.toBe(share2.shareId);
    });
  });

  describe("validateShare", () => {
    it("should validate active share", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      const result = service.validateShare(share.shareId);

      expect(result.isValid).toBe(true);
      expect(result.share).toBeDefined();
      expect(result.share!.shareId).toBe(share.shareId);
      expect(result.errorCode).toBeUndefined();
    });

    it("should reject invalid share ID", () => {
      const result = service.validateShare("non-existent-id");

      expect(result.isValid).toBe(false);
      expect(result.share).toBeUndefined();
      expect(result.errorCode).toBe("invalid");
    });

    it("should reject revoked share", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      service.revokeShare(share.shareId, "user-456");
      const result = service.validateShare(share.shareId);

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe("revoked");
    });

    it("should reject expired share", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
        expiresInDays: -1, // Already expired
      });

      const result = service.validateShare(share.shareId);

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe("expired");
    });
  });

  describe("streamFile", () => {
    it("should stream file for valid share", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await service.streamFile(share.shareId, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "File streaming would happen here",
        shareId: share.shareId,
      });

      // Check access count was incremented
      const updatedShare = service.getShareDetails(share.shareId);
      expect(updatedShare?.accessCount).toBe(1);
      expect(updatedShare?.lastAccessedAt).toBeInstanceOf(Date);
    });

    it("should fail for invalid share", async () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await expect(service.streamFile("invalid-id", mockRes)).rejects.toThrow(
        "Share validation failed: invalid",
      );
    });
  });

  describe("logAccess", () => {
    it("should log successful access", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      service.logAccess({
        shareId: share.shareId,
        ipAddress: "192.168.1.1",
        userAgent: "Test Agent",
        success: true,
        bytesTransferred: 1024,
      });

      const logs = service.getAccessLogs(share.shareId);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(true);
      expect(logs[0].ipAddress).toBe("192.168.1.1");
      expect(logs[0].userAgent).toBe("Test Agent");
      expect(logs[0].bytesTransferred).toBe(1024);
      expect(logs[0].errorCode).toBeUndefined();
    });

    it("should log failed access with error code", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      service.logAccess({
        shareId: share.shareId,
        ipAddress: "192.168.1.1",
        success: false,
        errorCode: "wrong_password",
      });

      const logs = service.getAccessLogs(share.shareId);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].errorCode).toBe("wrong_password");
    });
  });

  describe("cleanup", () => {
    it("should remove expired shares", async () => {
      const expiredShare = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
        expiresInDays: -1,
      });

      const activeShare = await service.createShare({
        fileId: "file-456",
        createdBy: "user-456",
        expiresInDays: 7,
      });

      service.cleanup();

      expect(service.getShareDetails(expiredShare.shareId)).toBeNull();
      expect(service.getShareDetails(activeShare.shareId)).toBeDefined();
    });

    it("should remove old access logs", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      // Manually add old logs (simulating 31 days ago)
      const oldLog = {
        shareId: share.shareId,
        timestamp: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        ipAddress: "192.168.1.1",
        success: true,
      } as any;

      const accessLogs = service.getAccessLogs(share.shareId);
      accessLogs.push(oldLog);

      service.cleanup();

      const remainingLogs = service.getAccessLogs(share.shareId);
      expect(remainingLogs).toHaveLength(0);
    });
  });

  describe("getUserShares", () => {
    it("should return shares for specific user", async () => {
      await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      await service.createShare({
        fileId: "file-789",
        createdBy: "user-456",
      });

      await service.createShare({
        fileId: "file-999",
        createdBy: "user-999",
      });

      const userShares = service.getUserShares("user-456");

      expect(userShares).toHaveLength(2);
      expect(userShares.every((share) => share.createdBy === "user-456")).toBe(true);
    });
  });

  describe("getShareDetails", () => {
    it("should return share details", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      const details = service.getShareDetails(share.shareId);

      expect(details).toBeDefined();
      expect(details?.shareId).toBe(share.shareId);
      expect(details?.fileId).toBe("file-123");
    });

    it("should return null for non-existent share", () => {
      const details = service.getShareDetails("non-existent-id");
      expect(details).toBeNull();
    });
  });

  describe("revokeShare", () => {
    it("should revoke share for owner", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      const result = service.revokeShare(share.shareId, "user-456");

      expect(result).toBe(true);
      expect(service.getShareDetails(share.shareId)?.isActive).toBe(false);
    });

    it("should not revoke share for non-owner", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      const result = service.revokeShare(share.shareId, "user-999");

      expect(result).toBe(false);
      expect(service.getShareDetails(share.shareId)?.isActive).toBe(true);
    });

    it("should not revoke non-existent share", () => {
      const result = service.revokeShare("non-existent-id", "user-456");
      expect(result).toBe(false);
    });
  });

  describe("getAccessLogs", () => {
    it("should return access logs for share", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      service.logAccess({
        shareId: share.shareId,
        ipAddress: "192.168.1.1",
        success: true,
      });

      const logs = service.getAccessLogs(share.shareId);
      expect(logs).toHaveLength(1);
    });

    it("should return empty array for non-existent share", () => {
      const logs = service.getAccessLogs("non-existent-id");
      expect(logs).toHaveLength(0);
    });

    it("should limit logs when limit is specified", async () => {
      const share = await service.createShare({
        fileId: "file-123",
        createdBy: "user-456",
      });

      service.logAccess({
        shareId: share.shareId,
        ipAddress: "192.168.1.1",
        success: true,
      });

      service.logAccess({
        shareId: share.shareId,
        ipAddress: "192.168.1.2",
        success: true,
      });

      service.logAccess({
        shareId: share.shareId,
        ipAddress: "192.168.1.3",
        success: true,
      });

      const logs = service.getAccessLogs(share.shareId, 2);
      expect(logs).toHaveLength(2);
    });
  });

  describe("validatePassword", () => {
    it("should still support password validation function", () => {
      // This is still used by the service, but passwords are now auto-generated
      const result = service.validatePassword("abcdef");

      expect(result.isValid).toBe(true);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBe(0);
    });

    it("should reject password too short", () => {
      const result = service.validatePassword("abcde");

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("6 characters");
    });

    it("should reject password too long", () => {
      const result = service.validatePassword("a".repeat(101));

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("100 characters");
    });
  });

  describe("hashPassword and comparePassword", () => {
    it("should hash password and verify it", async () => {
      const password = "TestPass123!";
      const hash = await service.hashPassword(password);

      expect(hash).not.toBe(password);
      expect(await service.comparePassword(password, hash)).toBe(true);
      expect(await service.comparePassword("wrongPassword", hash)).toBe(false);
    });
  });

  describe("Singleton instance", () => {
    it("should export a singleton instance", () => {
      expect(shareService).toBeInstanceOf(ShareService);
      // Check that the exported instance is the same type as our service
      expect(shareService.constructor.name).toBe("ShareService");
      expect(shareService).toHaveProperty("createShare");
      expect(shareService).toHaveProperty("validateShare");
      expect(shareService).toHaveProperty("streamFile");
    });
  });
});
