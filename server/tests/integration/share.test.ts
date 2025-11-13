import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import shareRouter from "../../src/routes/share";
import { shareService } from "../../src/services/ShareService";

// Create express app for testing
const app = express();
app.use(express.json());
app.use("/api/share", shareRouter);

describe("Share API Integration Tests", () => {
  // Helper to clear state
  const clearState = () => {
    shareService["shares"] = new Map();
    shareService["accessLogs"] = new Map();
  };

  beforeAll(() => {
    clearState();
  });

  describe("POST /api/share", () => {
    it("should create a share link without password", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Share link created successfully");
      expect(response.body.data.shareId).toBeDefined();
      expect(response.body.data.fileId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(response.body.data.createdBy).toBe("user-123");
      expect(response.body.data.url).toBeDefined();
      expect(response.body.data.url).toContain("/api/share/");
      expect(response.body.data.url).toContain("/download");
      expect(response.body.data.hasPassword).toBe(false);
      expect(response.body.data.accessCount).toBe(0);
      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.data.expiresAt).toBeDefined();
    });

    it("should create a share link with password", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hasPassword).toBe(true);
    });

    it("should create a share link with custom expiration", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          expiresInDays: 14,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.expiresAt).toBeDefined();

      const expiresAt = new Date(response.body.data.expiresAt);
      const now = new Date();
      const diffTime = expiresAt.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(13); // Allow for small timing differences
    });

    it("should reject invalid fileId format", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "invalid-uuid",
          createdBy: "user-123",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("VALIDATION_ERROR");
      expect(response.body.message).toContain("Invalid request data");
    });

    it("should reject weak password", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "weak",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("VALIDATION_ERROR");
      // Note: Zod catches this before the password validation logic
    });

    it("should reject invalid expiresInDays", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          expiresInDays: 100,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("VALIDATION_ERROR");
    });

    it("should use default createdBy when not provided", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.createdBy).toBe("temp-user-id");
    });

    it("should generate unique share IDs", async () => {
      const response1 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const response2 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440001",
          createdBy: "user-123",
        })
        .expect(201);

      expect(response1.body.data.shareId).not.toBe(response2.body.data.shareId);
    });
  });

  describe("GET /api/share/:shareId/download", () => {
    it("should successfully download from valid share link", async () => {
      // First create a share
      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Then download
      const downloadResponse = await request(app).get(`/api/share/${shareId}/download`).expect(200);

      expect(downloadResponse.body.success).toBe(true);
      expect(downloadResponse.body.message).toBe("File streaming would happen here");
      expect(downloadResponse.body.shareId).toBe(shareId);
    });

    it("should return 404 for non-existent share ID", async () => {
      const response = await request(app).get("/api/share/non-existent-id/download").expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("NOT_FOUND");
      expect(response.body.message).toContain("not found or expired");
    });

    it("should return 404 for expired share", async () => {
      // Clear state before test
      clearState();

      // Create a share
      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          expiresInDays: 7,
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Manually expire the share by setting expiration to past
      const details = shareService.getShareDetails(shareId);
      if (details) {
        details.expiresAt = new Date(Date.now() - 1000); // Set to past
      }

      const response = await request(app).get(`/api/share/${shareId}/download`).expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("NOT_FOUND");
    });

    it("should return 404 for revoked share", async () => {
      // Create a share
      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Revoke it directly via service (would be done via DELETE endpoint in real implementation)
      shareService.revokeShare(shareId, "user-123");

      // Try to download
      const response = await request(app).get(`/api/share/${shareId}/download`).expect(404);

      expect(response.body.success).toBe(false);
    });

    it("should increment access count on successful download", async () => {
      // Clear state before test
      clearState();

      // Create a share
      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Download twice
      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Check access count
      const details = shareService.getShareDetails(shareId);
      expect(details?.accessCount).toBe(2);
    });

    it("should log access attempts", async () => {
      // Create a share
      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Download
      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Check logs
      const logs = shareService.getAccessLogs(shareId);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(true);
      expect(logs[0].shareId).toBe(shareId);
    });

    it("should log failed access attempts", async () => {
      // Clear state before test
      clearState();

      // Try to download non-existent share
      await request(app).get("/api/share/non-existent-id/download").expect(404);

      // Logs should exist for the failed attempt
      const logs = shareService.getAccessLogs("non-existent-id");
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].errorCode).toBe("invalid");

      // Also test logging for an expired share
      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          expiresInDays: 7,
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Manually expire the share
      const details = shareService.getShareDetails(shareId);
      if (details) {
        details.expiresAt = new Date(Date.now() - 1000);
      }

      await request(app).get(`/api/share/${shareId}/download`).expect(404);

      const expiredLogs = shareService.getAccessLogs(shareId);
      expect(expiredLogs[0].success).toBe(false);
      expect(expiredLogs[0].errorCode).toBe("expired");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing request body", async () => {
      const response = await request(app).post("/api/share").send({}).expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should handle malformed JSON", async () => {
      const response = await request(app).post("/api/share").send('{"invalid": json}').expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should handle server errors gracefully", async () => {
      // This is a placeholder - in a real scenario we might test error conditions
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });

  describe("URL Format", () => {
    it("should generate correct URL format", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      expect(response.body.data.url).toMatch(/^http:\/\/.*\/api\/share\/.*\/download$/);
    });
  });

  describe("Data Consistency", () => {
    it("should properly serialize dates to ISO strings", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.data.expiresAt).toBeDefined();

      // Verify they're valid ISO date strings
      expect(new Date(response.body.data.createdAt).toISOString()).toBe(
        response.body.data.createdAt,
      );
      expect(new Date(response.body.data.expiresAt).toISOString()).toBe(
        response.body.data.expiresAt,
      );
    });
  });

  describe("Password-Protected Shares (User Story 2)", () => {
    it("should create share with password and require auth for download", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      expect(createResponse.body.data.hasPassword).toBe(true);
      const shareId = createResponse.body.data.shareId;

      // Try to download without password - should require auth
      const unauthorizedResponse = await request(app)
        .get(`/api/share/${shareId}/download`)
        .expect(401);

      expect(unauthorizedResponse.body.error).toBe("AUTHENTICATION_REQUIRED");
      expect(unauthorizedResponse.body.message).toContain("Password required");
    });

    it("should reject wrong password for password-protected share", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Try to download with wrong password
      const wrongPassword = Buffer.from("user:wrongpassword").toString("base64");
      const wrongResponse = await request(app)
        .get(`/api/share/${shareId}/download`)
        .set("Authorization", `Basic ${wrongPassword}`)
        .expect(401);

      expect(wrongResponse.body.error).toBe("INVALID_CREDENTIALS");
      expect(wrongResponse.body.message).toContain("Incorrect password");
    });

    it("should successfully download with correct password", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Download with correct password
      const correctPassword = Buffer.from("user:SecurePass123!").toString("base64");
      const successResponse = await request(app)
        .get(`/api/share/${shareId}/download`)
        .set("Authorization", `Basic ${correctPassword}`)
        .expect(200);

      expect(successResponse.body.success).toBe(true);

      // Check that access count was incremented
      const details = shareService.getShareDetails(shareId);
      expect(details?.accessCount).toBe(1);
    });

    it("should log failed password attempts", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Try with wrong password
      const wrongPassword = Buffer.from("user:wrong").toString("base64");
      await request(app)
        .get(`/api/share/${shareId}/download`)
        .set("Authorization", `Basic ${wrongPassword}`)
        .expect(401);

      // Check access logs
      const logs = shareService.getAccessLogs(shareId);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].errorCode).toBe("wrong_password");
    });

    it("should handle malformed authorization header", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Try with malformed auth header (doesn't start with 'Basic ')
      const malformedResponse = await request(app)
        .get(`/api/share/${shareId}/download`)
        .set("Authorization", "InvalidFormat")
        .expect(401);

      // Returns AUTHENTICATION_REQUIRED since it doesn't match 'Basic ' pattern
      expect(malformedResponse.body.error).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should handle invalid base64 in authorization header", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Try with invalid base64 after 'Basic '
      const invalidBase64 = await request(app)
        .get(`/api/share/${shareId}/download`)
        .set("Authorization", "Basic !@#$%^&*()")
        .expect(401);

      expect(invalidBase64.body.error).toBe("INVALID_CREDENTIALS");
    });

    it("should reject weak password during share creation", async () => {
      clearState();

      const weakPasswords = ["weak", "Weak1!", "WEAKPASS123", "Weakpass!"];

      for (const password of weakPasswords) {
        const response = await request(app)
          .post("/api/share")
          .send({
            fileId: "550e8400-e29b-41d4-a716-446655440000",
            createdBy: "user-123",
            password: password,
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      }
    });

    it("should hash password in database", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Check that password is not stored in plain text
      const shareDetails = shareService.getShareDetails(shareId);
      expect(shareDetails?.passwordHash).toBeDefined();
      expect(shareDetails?.passwordHash).not.toBe("SecurePass123!");
      expect(shareDetails?.passwordHash).not.toContain("SecurePass");
    });
  });

  describe("Share Management (User Story 3)", () => {
    it("should list all user shares", async () => {
      clearState();

      // Create multiple shares
      const share1 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const share2 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440001",
          createdBy: "user-123",
        })
        .expect(201);

      const share3 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440002",
          createdBy: "user-456", // Different user
        })
        .expect(201);

      // List shares for user-123
      const response = await request(app)
        .get("/api/share")
        .query({ userId: "user-123" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shares).toHaveLength(2);
      expect(response.body.data.total).toBe(2);
    });

    it("should filter shares by status", async () => {
      clearState();

      // Create active and expired shares
      const activeShare = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      // Manually expire a share
      const expiredShare = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440001",
          createdBy: "user-123",
        })
        .expect(201);

      const details = shareService.getShareDetails(expiredShare.body.data.shareId);
      if (details) {
        details.expiresAt = new Date(Date.now() - 1000);
      }

      // Get active shares
      const activeResponse = await request(app)
        .get("/api/share")
        .query({ userId: "user-123", status: "active" })
        .expect(200);

      expect(activeResponse.body.data.shares.length).toBeGreaterThanOrEqual(1);

      // Get expired shares
      const expiredResponse = await request(app)
        .get("/api/share")
        .query({ userId: "user-123", status: "expired" })
        .expect(200);

      expect(expiredResponse.body.data.shares.length).toBeGreaterThanOrEqual(1);
    });

    it("should paginate share list", async () => {
      clearState();

      // Create multiple shares
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/share")
          .send({
            fileId: `550e8400-e29b-41d4-a716-44665544000${i}`,
            createdBy: "user-123",
          })
          .expect(201);
      }

      // Get first page
      const page1 = await request(app)
        .get("/api/share")
        .query({ userId: "user-123", limit: 2, offset: 0 })
        .expect(200);

      expect(page1.body.data.shares).toHaveLength(2);
      expect(page1.body.data.limit).toBe(2);
      expect(page1.body.data.offset).toBe(0);

      // Get second page
      const page2 = await request(app)
        .get("/api/share")
        .query({ userId: "user-123", limit: 2, offset: 2 })
        .expect(200);

      expect(page2.body.data.shares).toHaveLength(2);
      expect(page2.body.data.offset).toBe(2);
    });

    it("should get share details", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
          password: "SecurePass123!",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Get details
      const response = await request(app).get(`/api/share/${shareId}`).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shareId).toBe(shareId);
      expect(response.body.data.hasPassword).toBe(true);
      expect(response.body.data.status).toBe("active");
      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.data.expiresAt).toBeDefined();
    });

    it("should return 404 for non-existent share details", async () => {
      clearState();

      const response = await request(app).get("/api/share/non-existent-id").expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("NOT_FOUND");
    });

    it("should revoke share link", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Revoke share
      const response = await request(app)
        .delete(`/api/share/${shareId}`)
        .send({ userId: "user-123" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Share link revoked successfully");

      // Verify share is revoked
      const details = shareService.getShareDetails(shareId);
      expect(details?.isActive).toBe(false);
    });

    it("should not revoke share for non-owner", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Try to revoke as different user
      const response = await request(app)
        .delete(`/api/share/${shareId}`)
        .send({ userId: "user-456" })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("FORBIDDEN");
    });

    it("should return 404 when revoking non-existent share", async () => {
      clearState();

      const response = await request(app)
        .delete("/api/share/non-existent-id")
        .send({ userId: "user-123" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("NOT_FOUND");
    });

    it("should get access logs for share", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Access the share
      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Get access logs
      const response = await request(app).get(`/api/share/${shareId}/access`).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.logs).toHaveLength(1);
      expect(response.body.data.logs[0].success).toBe(true);
      expect(response.body.data.logs[0].timestamp).toBeDefined();
      expect(response.body.data.logs[0].ipAddress).toBeDefined();
    });

    it("should limit access logs", async () => {
      clearState();

      const createResponse = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user-123",
        })
        .expect(201);

      const shareId = createResponse.body.data.shareId;

      // Access the share multiple times
      for (let i = 0; i < 5; i++) {
        await request(app).get(`/api/share/${shareId}/download`).expect(200);
      }

      // Get limited logs
      const response = await request(app)
        .get(`/api/share/${shareId}/access`)
        .query({ limit: 3 })
        .expect(200);

      expect(response.body.data.logs).toHaveLength(3);
      // Note: getAccessLogs returns limited logs, not total
    });

    it("should return 404 for access logs of non-existent share", async () => {
      clearState();

      const response = await request(app).get("/api/share/non-existent-id/access").expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("NOT_FOUND");
    });
  });
});
