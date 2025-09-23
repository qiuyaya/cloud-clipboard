import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileManager } from '../../services/FileManager';
import * as fs from 'fs';
import type { RoomKey } from '@cloud-clipboard/shared';

describe('FileManager', () => {
  let fileManager: FileManager;
  let mockFileRecord: {
    id: string;
    filename: string;
    path: string;
    roomKey: RoomKey;
    uploadedAt: Date;
    size: number;
  };

  beforeEach(() => {
    // Mock fs methods
    spyOn(fs, 'existsSync').mockReturnValue(true);
    spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    spyOn(fs, 'unlinkSync').mockReturnValue(undefined);
    
    // Mock console methods to avoid output during tests
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'error').mockImplementation(() => {});
    
    fileManager = new FileManager();
    
    mockFileRecord = {
      id: 'file-123',
      filename: 'test.txt',
      path: '/uploads/test.txt',
      roomKey: 'room123',
      uploadedAt: new Date(),
      size: 1024,
    };
  });

  afterEach(() => {
    fileManager.destroy();
  });

  describe('File Management', () => {
    it('should add file record', () => {
      fileManager.addFile(mockFileRecord);
      
      const retrievedFile = fileManager.getFile(mockFileRecord.id);
      expect(retrievedFile).toEqual(mockFileRecord);
    });

    it('should track files by room', () => {
      fileManager.addFile(mockFileRecord);
      
      const roomFiles = fileManager.getFilesInRoom(mockFileRecord.roomKey);
      expect(roomFiles).toHaveLength(1);
      expect(roomFiles[0]).toEqual(mockFileRecord);
    });

    it('should handle multiple files in same room', () => {
      const file2 = { ...mockFileRecord, id: 'file-456', filename: 'test2.txt' };
      
      fileManager.addFile(mockFileRecord);
      fileManager.addFile(file2);
      
      const roomFiles = fileManager.getFilesInRoom(mockFileRecord.roomKey);
      expect(roomFiles).toHaveLength(2);
    });

    it('should return undefined for non-existent file', () => {
      const file = fileManager.getFile('non-existent');
      expect(file).toBeUndefined();
    });

    it('should return empty array for room with no files', () => {
      const files = fileManager.getFilesInRoom('empty-room');
      expect(files).toHaveLength(0);
    });
  });

  describe('File Deletion', () => {
    beforeEach(() => {
      fileManager.addFile(mockFileRecord);
    });

    it('should delete file successfully', () => {
      const result = fileManager.deleteFile(mockFileRecord.id, 'manual');
      
      expect(result).toEqual({
        filename: mockFileRecord.filename,
        roomKey: mockFileRecord.roomKey,
      });
      expect(fileManager.getFile(mockFileRecord.id)).toBeUndefined();
    });

    it('should return null for non-existent file deletion', () => {
      const result = fileManager.deleteFile('non-existent', 'manual');
      
      expect(result).toBeNull();
    });

    it('should delete room files', () => {
      const file2 = { ...mockFileRecord, id: 'file-456', filename: 'test2.txt' };
      fileManager.addFile(file2);
      
      const deletedFiles = fileManager.deleteRoomFiles(mockFileRecord.roomKey);
      
      expect(deletedFiles).toHaveLength(2);
      expect(deletedFiles).toEqual([
        { filename: mockFileRecord.filename },
        { filename: file2.filename },
      ]);
      expect(fileManager.getFilesInRoom(mockFileRecord.roomKey)).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', () => {
      const file2 = { ...mockFileRecord, id: 'file-456', size: 2048 };
      const file3 = { ...mockFileRecord, id: 'file-789', roomKey: 'room456', size: 512 };
      
      fileManager.addFile(mockFileRecord);
      fileManager.addFile(file2);
      fileManager.addFile(file3);
      
      const stats = fileManager.getStats();
      
      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(1024 + 2048 + 512);
      expect(stats.roomCount).toBe(2); // Two different rooms
    });

    it('should return zero stats for empty manager', () => {
      const stats = fileManager.getStats();
      
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.roomCount).toBe(0);
    });
  });
});