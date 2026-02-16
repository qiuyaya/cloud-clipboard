import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { RoomKey } from "@cloud-clipboard/shared";
import { FILE_RETENTION_HOURS, FILE_CLEANUP_INTERVAL_MS } from "@cloud-clipboard/shared";
import { log } from "../utils/logger";

interface FileRecord {
  id: string;
  filename: string;
  path: string;
  roomKey: RoomKey;
  uploadedAt: Date;
  size: number;
  hash?: string; // 文件内容哈希，用于去重
}

export class FileManager {
  private files: Map<string, FileRecord> = new Map();
  private roomFiles: Map<RoomKey, Set<string>> = new Map();
  private hashToFileId: Map<string, Set<string>> = new Map(); // 哈希到文件ID集合的映射，用于去重
  private uploadDir = path.join(process.cwd(), "uploads");
  private maxRetentionHours = FILE_RETENTION_HOURS;
  private cleanupInterval: NodeJS.Timeout;
  // 添加文件统计信息
  private deletedFileCount = 0;
  private totalDeletedSize = 0;

  constructor() {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

    // 优化：清理间隔从1小时改为10分钟，更及时释放磁盘空间
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredFiles();
    }, FILE_CLEANUP_INTERVAL_MS);

    // Initial cleanup on startup - scan for orphaned files
    this.scanAndCleanupOrphanedFiles();

    // Initial cleanup on startup
    this.cleanupExpiredFiles();
  }

  /**
   * 扫描 uploads 目录，清理孤儿文件
   * 解决服务器重启后内存索引丢失但磁盘文件残留的问题
   */
  private scanAndCleanupOrphanedFiles(): void {
    try {
      const entries = fs.readdirSync(this.uploadDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(this.uploadDir, entry.name);
          const stats = fs.statSync(filePath);
          const age = Date.now() - stats.mtimeMs;

          // 如果文件超过 maxRetentionHours（12小时）未修改，视为过期文件
          const maxAge = this.maxRetentionHours * 60 * 60 * 1000;
          if (age > maxAge) {
            log.info("Removing stale orphan file", { filename: entry.name }, "FileManager");
            try {
              fs.unlinkSync(filePath);
            } catch (unlinkError) {
              log.error(
                "Failed to remove orphan file",
                { filename: entry.name, error: unlinkError },
                "FileManager",
              );
            }
          }
        }
      }

      log.info("Orphan file scan completed", {}, "FileManager");
    } catch (error) {
      log.error("Orphan file scan failed", { error }, "FileManager");
    }
  }

  addFile(fileRecord: FileRecord): void {
    this.files.set(fileRecord.id, fileRecord);

    // Track file by room
    if (!this.roomFiles.has(fileRecord.roomKey)) {
      this.roomFiles.set(fileRecord.roomKey, new Set());
    }
    this.roomFiles.get(fileRecord.roomKey)!.add(fileRecord.id);

    // Track file by hash for deduplication
    if (fileRecord.hash) {
      if (!this.hashToFileId.has(fileRecord.hash)) {
        this.hashToFileId.set(fileRecord.hash, new Set());
      }
      this.hashToFileId.get(fileRecord.hash)!.add(fileRecord.id);
    }
  }

  getFile(fileId: string): FileRecord | undefined {
    return this.files.get(fileId);
  }

  /**
   * 根据文件哈希查找已存在的文件
   * @param hash 文件内容的SHA-256哈希
   * @returns 文件ID，如果不存在则返回undefined
   */
  getFileIdByHash(hash: string): string | undefined {
    const fileIds = this.hashToFileId.get(hash);
    if (!fileIds) return undefined;
    // 返回第一个仍然存在的文件ID
    for (const fileId of fileIds) {
      if (this.files.has(fileId)) {
        return fileId;
      }
    }
    // 所有关联文件都已删除，清理哈希映射
    this.hashToFileId.delete(hash);
    return undefined;
  }

  /**
   * 计算文件内容的SHA-256哈希
   * @param filePath 文件路径
   * @returns SHA-256哈希字符串
   */
  async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  getFilesInRoom(roomKey: RoomKey): FileRecord[] {
    const fileIds = this.roomFiles.get(roomKey) || new Set();
    return Array.from(fileIds)
      .map((id) => this.files.get(id))
      .filter((file): file is FileRecord => file !== undefined);
  }

  deleteFile(
    fileId: string,
    reason: "room_destroyed" | "retention_expired" | "manual",
  ): { filename: string; roomKey: RoomKey } | null {
    const file = this.files.get(fileId);
    if (!file) return null;

    try {
      // Delete physical file
      if (fs.existsSync(file.path)) {
        // 使用同步方法确保文件删除完成，避免异步操作导致的竞态条件
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          log.error(
            "Failed to unlink file",
            { path: file.path, error: unlinkError },
            "FileManager",
          );
          // 即使文件删除失败，也继续清理跟踪信息，避免内存泄漏
        }
      }

      // Remove from tracking
      this.files.delete(fileId);
      const roomFiles = this.roomFiles.get(file.roomKey);
      if (roomFiles) {
        roomFiles.delete(fileId);
        if (roomFiles.size === 0) {
          this.roomFiles.delete(file.roomKey);
        }
      }

      // Remove from hash tracking
      if (file.hash) {
        const hashFileIds = this.hashToFileId.get(file.hash);
        if (hashFileIds) {
          hashFileIds.delete(fileId);
          if (hashFileIds.size === 0) {
            this.hashToFileId.delete(file.hash);
          }
        }
      }

      // 统计信息
      this.deletedFileCount++;
      this.totalDeletedSize += file.size;

      log.info("File deleted", { filename: file.filename, reason }, "FileManager");
      return { filename: file.filename, roomKey: file.roomKey };
    } catch (error) {
      log.error("Failed to delete file", { fileId, error }, "FileManager");
      return null;
    }
  }

  deleteRoomFiles(roomKey: RoomKey): { filename: string }[] {
    const fileIds = Array.from(this.roomFiles.get(roomKey) || []);
    const deletedFiles: { filename: string }[] = [];

    for (const fileId of fileIds) {
      const result = this.deleteFile(fileId, "room_destroyed");
      if (result) {
        deletedFiles.push({ filename: result.filename });
      }
    }

    this.roomFiles.delete(roomKey);
    log.info("Room files deleted", { roomKey, count: deletedFiles.length }, "FileManager");
    return deletedFiles;
  }

  private cleanupExpiredFiles(): void {
    const now = new Date();
    const maxAge = this.maxRetentionHours * 60 * 60 * 1000;
    const expiredFiles: string[] = [];

    for (const [fileId, file] of this.files.entries()) {
      const age = now.getTime() - file.uploadedAt.getTime();
      if (age > maxAge) {
        expiredFiles.push(fileId);
      }
    }

    for (const fileId of expiredFiles) {
      this.deleteFile(fileId, "retention_expired");
    }

    if (expiredFiles.length > 0) {
      log.info(
        "File cleanup completed",
        { expired: expiredFiles.length, totalDeleted: this.deletedFileCount },
        "FileManager",
      );
    }
  }

  getStats(): {
    totalFiles: number;
    totalSize: number;
    roomCount: number;
    deletedFiles: number;
    deletedSize: number;
  } {
    let totalSize = 0;
    for (const file of this.files.values()) {
      totalSize += file.size;
    }

    return {
      totalFiles: this.files.size,
      totalSize,
      roomCount: this.roomFiles.size,
      deletedFiles: this.deletedFileCount,
      deletedSize: this.totalDeletedSize,
    };
  }

  // 添加手动清理方法，用于压力测试
  forceCleanup(): { deleted: number; size: number } {
    const beforeCount = this.files.size;
    const beforeSize = this.getStats().totalSize;
    this.cleanupExpiredFiles();
    return {
      deleted: beforeCount - this.files.size,
      size: beforeSize - this.getStats().totalSize,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
