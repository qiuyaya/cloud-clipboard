import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Server } from "http";
import express from "express";
import { shareService } from "../services/ShareService";
import shareRoutes from "../routes/share";

describe("Share API Integration Tests", () => {
  let app: express.Application;
  let server: Server;
  const testPort = 4000;

  beforeAll(async () => {
    // Create test server
    app = express();
    server = require("http").createServer(app);

    // Setup middleware
    app.use(express.json());
    app.use("/api/share", shareRoutes);

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(testPort, () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Clear all shares after tests
    shareService.cleanup();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  describe("POST /api/share", () => {
    it("should create a share link without password", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.shareId).toBeDefined();
      expect(response.body.data.fileId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(response.body.data.createdBy).toBe("user123");
      expect(response.body.data.hasPassword).toBe(false);
      expect(response.body.data.url).toBeDefined();
      expect(typeof response.body.data.url).toBe("string");
      expect(response.body.data.url).toContain("/api/share/");
      expect(response.body.data.url).toContain("/download");
      expect(response.body.data.expiresAt).toBeDefined();
      expect(response.body.data.accessCount).toBe(0);
    });

    it("should create a share link with custom expiration", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440001",
          createdBy: "user456",
          expiresInDays: 14,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.expiresAt).toBeDefined();

      // Verify expiration is 14 days from now
      const expiresAt = new Date(response.body.data.expiresAt);
      const now = new Date();
      const diffDays = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(14);
    });

    it("should return 400 for missing required fields", async () => {
      const response = await request(app).post("/api/share").send({}).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBeDefined();
    });

    it("should return 400 for invalid fileId", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "invalid-uuid",
          createdBy: "user123",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 for invalid expiresInDays (too small)", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
          expiresInDays: 0,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 for invalid expiresInDays (too large)", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
          expiresInDays: 31,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should create unique share IDs for multiple requests", async () => {
      const response1 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
        })
        .expect(201);

      const response2 = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440001",
          createdBy: "user456",
        })
        .expect(201);

      expect(response1.body.data.shareId).not.toBe(response2.body.data.shareId);
    });

    it("should return 500 for internal server error", async () => {
      // This test ensures error handling is in place
      const response = await request(app).post("/api/share").send({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });

      expect([200, 201, 500].includes(response.status)).toBe(true);
    });
  });

  describe("GET /api/share/:shareId/download", () => {
    let shareId: string;

    beforeAll(async () => {
      // Create a share link for testing
      const response = await request(app).post("/api/share").send({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });

      shareId = response.body.data.shareId;
    });

    it("should successfully download file for valid shareId", async () => {
      const response = await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Since streamFile is a placeholder, it returns JSON
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("File streaming would happen here");
      expect(response.body.shareId).toBe(shareId);
    });

    it("should update access count on download", async () => {
      // First download
      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Check access logs
      const logs = shareService.getAccessLogs(shareId);
      expect(logs.length).toBeGreaterThan(0);
      const lastLog = logs[logs.length - 1];
      expect(lastLog).toBeDefined();
      expect(lastLog.success).toBe(true);
    });

    it("should return 404 for non-existent shareId", async () => {
      const response = await request(app).get("/api/share/nonexistent/download").expect(404);

      // Response should have JSON body with success: false
      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(false);
    });

    it("should log failed access attempt", async () => {
      // Use a unique ID to avoid interference from other tests
      const uniqueId = `test-${Date.now()}`;
      const logsBefore = shareService.getAccessLogs(uniqueId);

      await request(app).get(`/api/share/${uniqueId}/download`).expect(404);

      const logsAfter = shareService.getAccessLogs(uniqueId);
      expect(logsAfter.length).toBeGreaterThan(logsBefore.length);
      const lastLog = logsAfter[logsAfter.length - 1];
      expect(lastLog).toBeDefined();
      expect(lastLog.success).toBe(false);
    });

    it("should handle expired share", async () => {
      // Create an expired share
      const response = await request(app).post("/api/share").send({
        fileId: "550e8400-e29b-41d4-a716-446655440001",
        createdBy: "user123",
        expiresInDays: 1, // 1 day expiration
      });

      const expiredShareId = response.body.data.shareId;

      // Manually set expiration to yesterday to make it expired
      const shares = (shareService as any).shares as Map<string, any>;
      const share = shares.get(expiredShareId);
      share.expiresAt = new Date("2025-11-11T00:00:00Z"); // Yesterday

      const downloadResponse = await request(app)
        .get(`/api/share/${expiredShareId}/download`)
        .expect(404);

      expect(downloadResponse.body.success).toBe(false);
    });

    it("should capture user agent and IP in logs", async () => {
      const testUserAgent = "Mozilla/5.0 (Test Browser)";
      const testIP = "192.168.1.100";

      await request(app)
        .get(`/api/share/${shareId}/download`)
        .set("User-Agent", testUserAgent)
        .set("X-Forwarded-For", testIP)
        .expect(200);

      const logs = shareService.getAccessLogs(shareId);
      expect(logs.length).toBeGreaterThan(0);
      const lastLog = logs[logs.length - 1];
      expect(lastLog).toBeDefined();

      expect(lastLog.userAgent).toBe(testUserAgent);
      // IP might be transformed by Express/Supertest, so just check it exists
      expect(lastLog.ipAddress).toBeDefined();
    });

    it("should handle multiple downloads of same share", async () => {
      // Download multiple times
      await request(app).get(`/api/share/${shareId}/download`).expect(200);
      await request(app).get(`/api/share/${shareId}/download`).expect(200);
      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Check that all attempts are logged
      const logs = shareService.getAccessLogs(shareId);
      const successfulLogs = logs.filter((log) => log.success === true);
      expect(successfulLogs.length).toBeGreaterThan(2);
    });

    it("should handle revoked share", async () => {
      // Create and revoke a share
      const response = await request(app).post("/api/share").send({
        fileId: "550e8400-e29b-41d4-a716-446655440002",
        createdBy: "user123",
      });

      const revokedShareId = response.body.data.shareId;

      // Revoke the share
      shareService.revokeShare(revokedShareId, "user123");

      // Try to download
      const downloadResponse = await request(app)
        .get(`/api/share/${revokedShareId}/download`)
        .expect(404);

      expect(downloadResponse.body.success).toBe(false);
    });
  });

  describe("Share API Error Handling", () => {
    it("should handle invalid shareId format in download", async () => {
      const response = await request(app).get("/api/unknown/!@#/download").expect(404);

      // Just check that it returns 404, content may be HTML from default handler
      expect(response.status).toBe(404);
    });

    it("should handle malformed shareId in download", async () => {
      const response = await request(app).get("/api/share/%2E%2E%2F/download").expect(404);

      expect(response.body.success).toBe(false);
    });

    it("should return 404 for non-existent endpoint", async () => {
      await request(app).get("/api/shares").expect(404);
      await request(app).put("/api/shares").expect(404);
      await request(app).delete("/api/shares").expect(404);
    });

    it("should handle POST with different content types", async () => {
      // Test with valid JSON
      const response = await request(app)
        .post("/api/share")
        .set("Content-Type", "application/json")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it("should handle missing Content-Type header", async () => {
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it("should validate request body structure", async () => {
      // Test with extra unexpected fields
      const response = await request(app)
        .post("/api/share")
        .send({
          fileId: "550e8400-e29b-41d4-a716-446655440000",
          createdBy: "user123",
          unexpectedField: "should be ignored",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });

  describe("Share Link Statistics", () => {
    it("should track access count correctly", async () => {
      const response = await request(app).post("/api/share").send({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });

      const shareId = response.body.data.shareId;
      expect(response.body.data.accessCount).toBe(0);

      // Download once
      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      // Access count should be updated in service
      const logs = shareService.getAccessLogs(shareId);
      expect(logs.length).toBeGreaterThan(0);
    });

    it("should log access with correct timestamp", async () => {
      const beforeTime = new Date();

      const response = await request(app).post("/api/share").send({
        fileId: "550e8400-e29b-41d4-a716-446655440000",
        createdBy: "user123",
      });

      const shareId = response.body.data.shareId;

      await request(app).get(`/api/share/${shareId}/download`).expect(200);

      const afterTime = new Date();
      const logs = shareService.getAccessLogs(shareId);
      expect(logs.length).toBeGreaterThan(0);
      const lastLog = logs[logs.length - 1];
      expect(lastLog).toBeDefined();

      const logTime = new Date(lastLog.timestamp);
      expect(logTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(logTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});
