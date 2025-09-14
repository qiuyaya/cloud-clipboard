import * as fs from 'fs';
import * as path from 'path';
import type { RoomKey } from '@cloud-clipboard/shared';

interface FileRecord {
  id: string;
  filename: string;
  path: string;
  roomKey: RoomKey;
  uploadedAt: Date;
  size: number;
}

export class FileManager {
  private files: Map<string, FileRecord> = new Map();
  private roomFiles: Map<RoomKey, Set<string>> = new Map();
  private uploadDir = path.join(process.cwd(), 'uploads');
  private maxRetentionHours = 12;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

    // Start cleanup interval (check every hour)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredFiles();
    }, 60 * 60 * 1000);

    // Initial cleanup on startup
    this.cleanupExpiredFiles();
  }

  addFile(fileRecord: FileRecord): void {
    this.files.set(fileRecord.id, fileRecord);
    
    // Track file by room
    if (!this.roomFiles.has(fileRecord.roomKey)) {
      this.roomFiles.set(fileRecord.roomKey, new Set());
    }
    this.roomFiles.get(fileRecord.roomKey)!.add(fileRecord.id);
    
    console.log(`File ${fileRecord.filename} tracked for room ${fileRecord.roomKey}`);
  }

  getFile(fileId: string): FileRecord | undefined {
    return this.files.get(fileId);
  }

  getFilesInRoom(roomKey: RoomKey): FileRecord[] {
    const fileIds = this.roomFiles.get(roomKey) || new Set();
    return Array.from(fileIds)
      .map(id => this.files.get(id))
      .filter((file): file is FileRecord => file !== undefined);
  }

  deleteFile(fileId: string, reason: 'room_destroyed' | 'retention_expired' | 'manual'): { filename: string; roomKey: RoomKey } | null {
    const file = this.files.get(fileId);
    if (!file) return null;

    try {
      // Delete physical file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
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

      console.log(`File ${file.filename} deleted (reason: ${reason})`);
      return { filename: file.filename, roomKey: file.roomKey };
    } catch (error) {
      console.error('Failed to delete file %s:', fileId, error);
      return null;
    }
  }

  deleteRoomFiles(roomKey: RoomKey): { filename: string }[] {
    const fileIds = Array.from(this.roomFiles.get(roomKey) || []);
    const deletedFiles: { filename: string }[] = [];

    for (const fileId of fileIds) {
      const result = this.deleteFile(fileId, 'room_destroyed');
      if (result) {
        deletedFiles.push({ filename: result.filename });
      }
    }

    this.roomFiles.delete(roomKey);
    console.log(`Deleted ${deletedFiles.length} files for destroyed room ${roomKey}`);
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
      this.deleteFile(fileId, 'retention_expired');
    }

    if (expiredFiles.length > 0) {
      console.log(`Cleaned up ${expiredFiles.length} expired files`);
    }
  }

  getStats(): { totalFiles: number; totalSize: number; roomCount: number } {
    let totalSize = 0;
    for (const file of this.files.values()) {
      totalSize += file.size;
    }

    return {
      totalFiles: this.files.size,
      totalSize,
      roomCount: this.roomFiles.size
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}