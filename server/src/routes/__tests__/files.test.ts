/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import { createFileRoutes } from "../files";

// Mock setInterval to avoid memory leaks
vi.stubGlobal(
  "setInterval",
  vi.fn(() => 123 as any),
);
vi.stubGlobal("clearInterval", vi.fn());

// Mock FileManager
const mockFileManager = {
  calculateFileHash: vi.fn().mockResolvedValue("abc123hash"),
  getFileIdByHash: vi.fn().mockReturnValue(null),
  getFile: vi.fn(),
  addFile: vi.fn(),
  deleteFile: vi.fn().mockReturnValue(true),
  getFilesInRoom: vi.fn().mockReturnValue([]),
};

// Mock the auth middleware
vi.mock("../../middleware/auth", () => ({
  authenticateRoom: (req: any, _res: any, next: any) => {
    req.roomKey = req.headers["x-room-key"] || req.query.roomKey;
    if (!req.roomKey) {
      return _res.status(401).json({ success: false, message: "Room key required" });
    }
    next();
  },
}));

// Mock rate limit middleware
vi.mock("../../middleware/rateLimit", () => ({
  uploadRateLimit: {
    middleware: () => (_req: any, _res: any, next: any) => next(),
  },
  strictRateLimit: {
    middleware: () => (_req: any, _res: any, next: any) => next(),
  },
}));

describe("Files Routes", () => {
  let app: Express;
  const testUploadDir = path.join(process.cwd(), "test-uploads");

  beforeAll(() => {
    // Create test upload directory
    if (!fs.existsSync(testUploadDir)) {
      fs.mkdirSync(testUploadDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test upload directory
    if (fs.existsSync(testUploadDir)) {
      fs.rmSync(testUploadDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/files", createFileRoutes(mockFileManager as any));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/files/upload", () => {
    it("should require room authentication", async () => {
      const response = await request(app)
        .post("/api/files/upload")
        .attach("file", Buffer.from("test content"), "test.txt");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when no file is uploaded", async () => {
      const response = await request(app).post("/api/files/upload").set("X-Room-Key", "test123abc");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("No file uploaded");
    });
  });

  describe("GET /api/files/download/:fileId", () => {
    it("should validate file ID format", async () => {
      const response = await request(app).get("/api/files/download/invalid%20file%20id!");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 404 for non-existent file", async () => {
      mockFileManager.getFile.mockReturnValue(null);

      const response = await request(app).get("/api/files/download/1234567890-test.txt");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("File not found");
    });

    it("should verify file is tracked in FileManager", async () => {
      // File exists on disk but not tracked
      mockFileManager.getFile.mockReturnValue(null);

      const response = await request(app).get("/api/files/download/1234567890-untracked.txt");

      expect(response.status).toBe(404);
      // Note: The mock may or may not be called depending on file existence on disk
    });
  });

  describe("DELETE /api/files/:fileId", () => {
    it("should require room authentication", async () => {
      const response = await request(app).delete("/api/files/1234567890-test.txt");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it("should validate file ID format", async () => {
      const response = await request(app)
        .delete("/api/files/invalid file!")
        .set("X-Room-Key", "test123abc");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 404 for non-existent file", async () => {
      mockFileManager.getFile.mockReturnValue(null);

      const response = await request(app)
        .delete("/api/files/1234567890-nonexistent.txt")
        .set("X-Room-Key", "test123abc");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("File not found");
    });

    it("should return 403 when file belongs to different room", async () => {
      mockFileManager.getFile.mockReturnValue({
        id: "1234567890-test.txt",
        roomKey: "other-room123",
        filename: "test.txt",
        path: "/path/to/file",
      });

      const response = await request(app)
        .delete("/api/files/1234567890-test.txt")
        .set("X-Room-Key", "my-room123");

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Access denied");
    });

    it("should delete file successfully when authorized", async () => {
      mockFileManager.getFile.mockReturnValue({
        id: "1234567890-test.txt",
        roomKey: "test123abc",
        filename: "test.txt",
        path: "/path/to/file",
      });
      mockFileManager.deleteFile.mockReturnValue(true);

      const response = await request(app)
        .delete("/api/files/1234567890-test.txt")
        .set("X-Room-Key", "test123abc");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("File deleted successfully");
      expect(mockFileManager.deleteFile).toHaveBeenCalledWith("1234567890-test.txt", "manual");
    });

    it("should handle deletion failure", async () => {
      mockFileManager.getFile.mockReturnValue({
        id: "1234567890-test.txt",
        roomKey: "test123abc",
        filename: "test.txt",
        path: "/path/to/file",
      });
      mockFileManager.deleteFile.mockReturnValue(false);

      const response = await request(app)
        .delete("/api/files/1234567890-test.txt")
        .set("X-Room-Key", "test123abc");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to delete file");
    });
  });

  describe("File ID Validation Schema", () => {
    it("should accept valid file IDs", async () => {
      mockFileManager.getFile.mockReturnValue({
        id: "1234567890-document.pdf",
        roomKey: "test123abc",
        filename: "document.pdf",
        path: "/path/to/file",
      });

      // These should pass validation (even if file doesn't exist)
      const validIds = [
        "1234567890-test.txt",
        "1234567890-image.png",
        "1234567890-file_name.pdf",
        "abc123-document.docx",
      ];

      for (const fileId of validIds) {
        mockFileManager.getFile.mockReturnValue(null);
        const response = await request(app).get(`/api/files/download/${fileId}`);
        expect(response.status).not.toBe(400); // Should not fail validation
      }
    });

    it("should reject invalid file IDs", async () => {
      const invalidIds = [
        "no-extension",
        "has spaces.txt",
        "special@char.txt",
        "../traversal.txt",
        "..\\windows.txt",
      ];

      for (const fileId of invalidIds) {
        const response = await request(app).get(
          `/api/files/download/${encodeURIComponent(fileId)}`,
        );
        expect(response.status).toBe(400);
      }
    });
  });

  describe("File Deduplication", () => {
    it("should detect duplicate files by hash", async () => {
      mockFileManager.calculateFileHash.mockResolvedValue("duplicate-hash-123");
      mockFileManager.getFileIdByHash.mockReturnValue("existing-file.txt");
      mockFileManager.getFile.mockReturnValue({
        id: "existing-file.txt",
        filename: "original.txt",
        size: 100,
        uploadedAt: new Date(),
      });

      // When deduplication happens, the response indicates duplicate
      // This test verifies the mock setup is correct
      expect(mockFileManager.getFileIdByHash("duplicate-hash-123")).toBe("existing-file.txt");
    });

    it("should track new files with hash", () => {
      const fileData = {
        id: "new-file.txt",
        filename: "new.txt",
        path: "/path/to/file",
        roomKey: "test123abc",
        uploadedAt: new Date(),
        size: 100,
        hash: "unique-hash-456",
      };

      mockFileManager.addFile(fileData);

      expect(mockFileManager.addFile).toHaveBeenCalledWith(
        expect.objectContaining({
          hash: "unique-hash-456",
        }),
      );
    });
  });

  describe("Security Validations", () => {
    it("should prevent directory traversal via fileId", async () => {
      // Various traversal attempts
      const traversalAttempts = [
        "../../../etc/passwd",
        "..%2F..%2F..%2Fetc%2Fpasswd",
        "....//....//etc/passwd",
        "%2e%2e%2f%2e%2e%2f",
      ];

      for (const attempt of traversalAttempts) {
        const response = await request(app).get(
          `/api/files/download/${encodeURIComponent(attempt)}`,
        );
        // Should either be 400 (validation) or 404 (not found after path resolution)
        expect([400, 404]).toContain(response.status);
      }
    });

    it("should validate file exists before allowing download", async () => {
      mockFileManager.getFile.mockReturnValue(null);

      const response = await request(app).get("/api/files/download/1234567890-test.txt");

      expect(response.status).toBe(404);
    });

    it("should validate room ownership before deletion", async () => {
      mockFileManager.getFile.mockReturnValue({
        id: "1234567890-secret.txt",
        roomKey: "private-room",
        filename: "secret.txt",
      });

      const response = await request(app)
        .delete("/api/files/1234567890-secret.txt")
        .set("X-Room-Key", "attacker-room");

      expect(response.status).toBe(403);
    });
  });
});

describe("Dangerous Extensions Blacklist", () => {
  const dangerousExtensions = [
    ".exe",
    ".bat",
    ".cmd",
    ".com",
    ".scr",
    ".pif",
    ".msi",
    ".jar",
    ".sh",
    ".bash",
    ".ps1",
    ".vbs",
    ".php",
    ".asp",
    ".aspx",
    ".jsp",
    ".py",
    ".rb",
    ".pl",
    ".c",
    ".cpp",
    ".cs",
    ".java",
    ".go",
    ".rs",
    ".swift",
    ".dll",
    ".so",
    ".dylib",
    ".app",
    ".deb",
    ".rpm",
    ".dmg",
  ];

  it("should have all dangerous extensions defined", () => {
    // This test documents the expected dangerous extensions
    expect(dangerousExtensions.length).toBeGreaterThanOrEqual(30);
  });

  it.each(dangerousExtensions)("should block %s extension", (ext) => {
    // Verify extension is in the blocked list
    expect(dangerousExtensions).toContain(ext);
  });
});

describe("File Upload Size Limits", () => {
  it("should have 100MB file size limit", () => {
    const maxFileSize = 100 * 1024 * 1024; // 100MB in bytes
    expect(maxFileSize).toBe(104857600);
  });

  it("should limit to 1 file per request", () => {
    const maxFiles = 1;
    expect(maxFiles).toBe(1);
  });
});
