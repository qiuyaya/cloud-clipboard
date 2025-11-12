import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShareService } from "../ShareService";
import type { ShareLink } from "@cloud-clipboard/shared";

// Mock Date
const mockDate = new Date("2025-11-12T00:00:00Z");

describe("ShareService", () => {
  let shareService: ShareService;

  beforeEach(() => {
    vi.setSystemTime(mockDate);
    shareService = new ShareService();
  });

  describe("createShare", () => {
    it("should create a share link without password", async () => {
      const result = await shareService.createShare({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });

      expect(result.shareId).toBeDefined();
      expect(result.fileId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(result.createdAt).toEqual(mockDate);
      expect(result.passwordHash).toBeNull();
      expect(result.accessCount).toBe(0);
      expect(result.isActive).toBe(true);
      expect(result.createdBy).toBe("user123");
    });

    it("should use default expiration of 7 days", async () => {
      const result = await shareService.createShare({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });

      const expectedExpiry = new Date(mockDate);
      expectedExpiry.setDate(expectedExpiry.getDate() + 7);

      expect(result.expiresAt).toEqual(expectedExpiry);
    });
  });

  describe("validateShare", () => {
    beforeEach(async () => {
      await shareService.createShare({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });
    });

    it("should validate active and non-expired share", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const firstShare = shares.values().next().value;
      expect(firstShare).toBeDefined();

      const result = shareService.validateShare(firstShare!.shareId);

      expect(result.isValid).toBe(true);
      expect(result.share).toBeDefined();
      expect(result.errorCode).toBeUndefined();
    });

    it("should return invalid for non-existent share", () => {
      const result = shareService.validateShare("nonexistent");

      expect(result.isValid).toBe(false);
      expect(result.share).toBeUndefined();
      expect(result.errorCode).toBe("invalid");
    });

    it("should return revoked for inactive share", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const firstShare = shares.values().next().value;
      expect(firstShare).toBeDefined();
      firstShare!.isActive = false;

      const result = shareService.validateShare(firstShare!.shareId);

      expect(result.isValid).toBe(false);
      expect(result.share?.isActive).toBe(false);
      expect(result.errorCode).toBe("revoked");
    });

    it("should mark expired share as inactive", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const firstShare = shares.values().next().value;
      expect(firstShare).toBeDefined();
      firstShare!.expiresAt = new Date("2025-11-11T00:00:00Z"); // Yesterday

      const result = shareService.validateShare(firstShare!.shareId);

      expect(result.isValid).toBe(false);
      expect(result.share?.isActive).toBe(false);
      expect(result.errorCode).toBe("expired");
      expect(firstShare!.isActive).toBe(false); // Should be marked inactive
    });
  });

  describe("logAccess", () => {
    beforeEach(async () => {
      await shareService.createShare({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });
    });

    it("should log successful access", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const firstShare = shares.values().next().value;
      expect(firstShare).toBeDefined();

      shareService.logAccess({
        shareId: firstShare!.shareId,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        success: true,
        bytesTransferred: 1024,
      });

      const logs = (shareService as any).accessLogs as Map<string, any[]>;
      const shareLogs = logs.get(firstShare!.shareId);

      expect(shareLogs).toBeDefined();
      expect(shareLogs.length).toBe(1);
      expect(shareLogs![0].shareId).toBe(firstShare!.shareId);
      expect(shareLogs![0].ipAddress).toBe("192.168.1.1");
      expect(shareLogs![0].success).toBe(true);
    });

    it("should log failed access with error code", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const firstShare = shares.values().next().value;
      expect(firstShare).toBeDefined();

      shareService.logAccess({
        shareId: firstShare!.shareId,
        ipAddress: "192.168.1.2",
        success: false,
        errorCode: "wrong_password",
      });

      const logs = (shareService as any).accessLogs as Map<string, any[]>;
      const shareLogs = logs.get(firstShare!.shareId);

      expect(shareLogs.length).toBe(1);
      expect(shareLogs![0].success).toBe(false);
      expect(shareLogs![0].errorCode).toBe("wrong_password");
    });
  });

  describe("cleanup", () => {
    it("should remove expired shares", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;

      shares.set("active", {
        shareId: "active",
        fileId: "file1",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-13T00:00:00Z"), // Tomorrow
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user1",
      });

      shares.set("expired", {
        shareId: "expired",
        fileId: "file2",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-11T00:00:00Z"), // Yesterday
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user2",
      });

      shareService.cleanup();

      expect(shares.has("active")).toBe(true);
      expect(shares.has("expired")).toBe(false);
    });

    it("should remove logs older than 30 days", () => {
      const accessLogs = (shareService as any).accessLogs as Map<string, any[]>;
      accessLogs.set("share1", [
        {
          timestamp: new Date("2025-10-01T00:00:00Z"), // 42 days ago
          shareId: "share1",
        },
        {
          timestamp: new Date("2025-11-01T00:00:00Z"), // 11 days ago
          shareId: "share1",
        },
      ]);

      shareService.cleanup();

      expect(accessLogs.get("share1")?.length).toBe(1);
    });
  });

  describe("getUserShares", () => {
    it("should return shares for specific user", async () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;

      const share1 = {
        shareId: "share1",
        fileId: "file1",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-19T00:00:00Z"),
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user123",
      };

      const share2 = {
        shareId: "share2",
        fileId: "file2",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-19T00:00:00Z"),
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user456",
      };

      const share3 = {
        shareId: "share3",
        fileId: "file3",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-19T00:00:00Z"),
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user123",
      };

      shares.set("share1", share1);
      shares.set("share2", share2);
      shares.set("share3", share3);

      const user123Shares = shareService.getUserShares("user123");
      const user456Shares = shareService.getUserShares("user456");

      expect(user123Shares.length).toBe(2);
      expect(user456Shares.length).toBe(1);
    });
  });

  describe("getShareDetails", () => {
    it("should return share details for valid shareId", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const share = {
        shareId: "testShare",
        fileId: "file1",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-19T00:00:00Z"),
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user123",
      };
      shares.set("testShare", share);

      const result = shareService.getShareDetails("testShare");

      expect(result).toBeDefined();
      expect(result?.shareId).toBe("testShare");
      expect(result?.fileId).toBe("file1");
    });

    it("should return null for non-existent share", () => {
      const result = shareService.getShareDetails("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("revokeShare", () => {
    it("should revoke share owned by user", () => {
      const shares = (shareService as any).shares as Map<string, ShareLink>;
      const share = {
        shareId: "testShare",
        fileId: "file1",
        createdAt: mockDate,
        expiresAt: new Date("2025-11-19T00:00:00Z"),
        passwordHash: null,
        accessCount: 0,
        lastAccessedAt: null,
        isActive: true,
        createdBy: "user123",
      };
      shares.set("testShare", share);

      const result = shareService.revokeShare("testShare", "user123");
      expect(result).toBe(true);
      expect(share.isActive).toBe(false);
    });

    it("should return false for non-existent share", () => {
      const result = shareService.revokeShare("nonexistent", "user123");
      expect(result).toBe(false);
    });
  });
});
