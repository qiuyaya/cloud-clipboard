/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FileManager } from "../FileManager";
import * as fs from "fs";
import * as path from "path";

// Mock fs module
vi.mock("fs");
vi.mock("path");

describe("FileManager", () => {
  let fileManager: FileManager;
  let mockFs: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs = {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      statSync: vi.fn(),
      unlinkSync: vi.fn(),
      readdirSync: vi.fn().mockReturnValue([]),
      promises: {
        unlink: vi.fn().mockResolvedValue(undefined),
      },
    };

    vi.spyOn(fs, "existsSync").mockImplementation(mockFs.existsSync);
    vi.spyOn(fs, "mkdirSync").mockImplementation(mockFs.mkdirSync);
    vi.spyOn(fs, "statSync").mockImplementation(mockFs.statSync);
    vi.spyOn(fs, "unlinkSync").mockImplementation(mockFs.unlinkSync);
    vi.spyOn(fs, "readdirSync").mockImplementation(mockFs.readdirSync);
    vi.spyOn(fs.promises, "unlink").mockImplementation(mockFs.promises.unlink);

    // Mock setInterval and clearInterval
    vi.stubGlobal(
      "setInterval",
      vi.fn((cb) => {
        // Execute cleanup immediately for testing
        setTimeout(() => cb(), 0);
        return 123 as any;
      }),
    );
    vi.stubGlobal("clearInterval", vi.fn());

    mockFs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("should create upload directory if it does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);
      vi.mocked(path.join).mockReturnValue("/test/uploads");
      fileManager = new FileManager();

      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });

    it("should not create directory if it already exists", () => {
      mockFs.existsSync.mockReturnValue(true);
      fileManager = new FileManager();

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("addFile", () => {
    beforeEach(() => {
      fileManager = new FileManager();
    });

    it("should add file to tracking", () => {
      const fileRecord = {
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      };

      fileManager.addFile(fileRecord);

      const retrieved = fileManager.getFile("file1");
      expect(retrieved).toEqual(fileRecord);
    });

    it("should track file by room", () => {
      const fileRecord = {
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      };

      fileManager.addFile(fileRecord);

      const roomFiles = fileManager.getFilesInRoom("room123");
      expect(roomFiles).toHaveLength(1);
      expect(roomFiles[0]).toEqual(fileRecord);
    });

    it("should handle multiple files in same room", () => {
      fileManager.addFile({
        id: "file1",
        filename: "test1.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      });

      fileManager.addFile({
        id: "file2",
        filename: "test2.txt",
        path: "/uploads/file2",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 2048,
      });

      const roomFiles = fileManager.getFilesInRoom("room123");
      expect(roomFiles).toHaveLength(2);
    });
  });

  describe("getFile", () => {
    beforeEach(() => {
      fileManager = new FileManager();
    });

    it("should retrieve file by ID", () => {
      const fileRecord = {
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      };

      fileManager.addFile(fileRecord);

      const retrieved = fileManager.getFile("file1");
      expect(retrieved).toEqual(fileRecord);
    });

    it("should return undefined for non-existent file", () => {
      const retrieved = fileManager.getFile("nonexistent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("getFilesInRoom", () => {
    beforeEach(() => {
      fileManager = new FileManager();
    });

    it("should return all files in room", () => {
      fileManager.addFile({
        id: "file1",
        filename: "test1.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      });

      fileManager.addFile({
        id: "file2",
        filename: "test2.txt",
        path: "/uploads/file2",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 2048,
      });

      const roomFiles = fileManager.getFilesInRoom("room123");
      expect(roomFiles).toHaveLength(2);
    });

    it("should return empty array for room with no files", () => {
      const roomFiles = fileManager.getFilesInRoom("empty_room");
      expect(roomFiles).toEqual([]);
    });
  });

  describe("deleteFile", () => {
    beforeEach(() => {
      fileManager = new FileManager();
      mockFs.existsSync.mockReturnValue(true);
    });

    it("should delete file successfully", () => {
      const fileRecord = {
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      };

      fileManager.addFile(fileRecord);

      const result = fileManager.deleteFile("file1", "manual");

      expect(result).toEqual({ filename: "test.txt", roomKey: "room123" });
      expect(fileManager.getFile("file1")).toBeUndefined();
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/uploads/file1");
    });

    it("should return null for non-existent file", () => {
      const result = fileManager.deleteFile("nonexistent", "manual");
      expect(result).toBeNull();
    });

    it("should handle file deletion error", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error("Delete failed");
      });

      const fileRecord = {
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      };

      fileManager.addFile(fileRecord);
      const result = fileManager.deleteFile("file1", "manual");

      // File is still removed from tracking despite deletion error
      expect(result).toEqual({ filename: "test.txt", roomKey: "room123" });
      expect(fileManager.getFile("file1")).toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("should remove room from tracking when last file is deleted", () => {
      const fileRecord = {
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      };

      fileManager.addFile(fileRecord);
      fileManager.deleteFile("file1", "manual");

      const roomFiles = fileManager.getFilesInRoom("room123");
      expect(roomFiles).toEqual([]);
    });
  });

  describe("deleteRoomFiles", () => {
    beforeEach(() => {
      fileManager = new FileManager();
      mockFs.existsSync.mockReturnValue(true);
    });

    it("should delete all files in room", () => {
      fileManager.addFile({
        id: "file1",
        filename: "test1.txt",
        path: "/uploads/file1",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 1024,
      });

      fileManager.addFile({
        id: "file2",
        filename: "test2.txt",
        path: "/uploads/file2",
        roomKey: "room123",
        uploadedAt: new Date(),
        size: 2048,
      });

      const deleted = fileManager.deleteRoomFiles("room123");

      expect(deleted).toHaveLength(2);
      expect(deleted[0]).toEqual({ filename: "test1.txt" });
      expect(deleted[1]).toEqual({ filename: "test2.txt" });
      expect(fileManager.getFilesInRoom("room123")).toEqual([]);
    });

    it("should handle empty room", () => {
      const deleted = fileManager.deleteRoomFiles("empty_room");
      expect(deleted).toEqual([]);
    });
  });

  describe("cleanupExpiredFiles", () => {
    beforeEach(() => {
      fileManager = new FileManager();
      mockFs.existsSync.mockReturnValue(true);
    });

    it("should delete files older than max retention", () => {
      const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000); // 13 hours ago
      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago

      fileManager.addFile({
        id: "oldFile",
        filename: "old.txt",
        path: "/uploads/oldFile",
        roomKey: "room1",
        uploadedAt: oldDate,
        size: 1024,
      });

      fileManager.addFile({
        id: "newFile",
        filename: "new.txt",
        path: "/uploads/newFile",
        roomKey: "room2",
        uploadedAt: recentDate,
        size: 2048,
      });

      // Manually trigger cleanup
      (fileManager as any).cleanupExpiredFiles();

      expect(fileManager.getFile("oldFile")).toBeUndefined();
      expect(fileManager.getFile("newFile")).toBeDefined();
    });
  });

  describe("getStats", () => {
    beforeEach(() => {
      fileManager = new FileManager();
    });

    it("should return correct statistics", () => {
      fileManager.addFile({
        id: "file1",
        filename: "test1.txt",
        path: "/uploads/file1",
        roomKey: "room1",
        uploadedAt: new Date(),
        size: 1024,
      });

      fileManager.addFile({
        id: "file2",
        filename: "test2.txt",
        path: "/uploads/file2",
        roomKey: "room2",
        uploadedAt: new Date(),
        size: 2048,
      });

      const stats = fileManager.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBe(3072);
      expect(stats.roomCount).toBe(2);
      expect(stats.deletedFiles).toBe(0);
      expect(stats.deletedSize).toBe(0);
    });
  });

  describe("forceCleanup", () => {
    beforeEach(() => {
      fileManager = new FileManager();
      mockFs.existsSync.mockReturnValue(true);
    });

    it("should trigger cleanup and return statistics", () => {
      fileManager.addFile({
        id: "file1",
        filename: "test.txt",
        path: "/uploads/file1",
        roomKey: "room1",
        uploadedAt: new Date(),
        size: 1024,
      });

      const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000);
      fileManager.addFile({
        id: "oldFile",
        filename: "old.txt",
        path: "/uploads/oldFile",
        roomKey: "room2",
        uploadedAt: oldDate,
        size: 2048,
      });

      const result = fileManager.forceCleanup();

      expect(result.deleted).toBe(1);
      expect(result.size).toBe(2048);
    });
  });

  describe("destroy", () => {
    it("should clear cleanup interval", () => {
      const clearIntervalSpy = vi.fn();
      vi.stubGlobal("clearInterval", clearIntervalSpy);

      fileManager = new FileManager();
      fileManager.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
