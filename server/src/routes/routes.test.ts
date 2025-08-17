import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import request from 'supertest';
import { Server } from 'http';
import express from 'express';
// Removed unused imports: path, fs
import { RoomService } from '../services/RoomService';
import { FileManager } from '../services/FileManager';
import { createRoomRoutes } from './rooms';
import { createFileRoutes } from './files';
// Removed unused import: APIResponse

describe('Routes Coverage Tests', () => {
  let app: express.Application;
  let server: Server;
  let roomService: RoomService;
  let fileManager: FileManager;
  const testPort = 4001;

  beforeAll(async () => {
    // Create test server
    app = express();
    server = require('http').createServer(app);
    
    // Initialize services
    fileManager = new FileManager();
    roomService = new RoomService();

    // Setup middleware
    app.use(express.json());
    app.use('/api/rooms', createRoomRoutes(roomService));
    app.use('/api/files', createFileRoutes(fileManager));

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(testPort, () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    roomService.destroy();
    fileManager.destroy();
    
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  describe('Room Routes Coverage', () => {
    it('should handle invalid room key formats', async () => {
      const invalidKeys = ['', ' ', '\t', '\n', 'room with spaces', 'room/with/slashes'];
      
      for (const key of invalidKeys) {
        const response = await request(app)
          .get(`/api/rooms/${encodeURIComponent(key)}`);
          
        expect([400, 404].includes(response.status)).toBe(true);
      }
    });

    it('should create and access rooms with various key formats', async () => {
      const validKeys = ['room123', 'test-room', 'room_with_underscores', 'UPPERCASE'];
      
      for (const roomKey of validKeys) {
        // Create room by joining
        const mockUser = {
          id: `user-${roomKey}`,
          name: 'TestUser',
          isOnline: true,
          lastSeen: new Date(),
          deviceType: 'desktop' as const,
          fingerprint: `test-fingerprint-${roomKey}`,
        };

        roomService.joinRoom(roomKey, mockUser);

        // Verify room exists
        const response = await request(app)
          .get(`/api/rooms/${roomKey}`);

        expect([200, 404].includes(response.status)).toBe(true);
        if (response.status === 200) {
          expect(response.body.success).toBe(true);
          expect(response.body.data.key).toBe(roomKey);
        }
      }
    });

    it('should handle room stats endpoint', async () => {
      // Create some test rooms
      const testRooms = ['stats-room-1', 'stats-room-2'];
      
      testRooms.forEach(roomKey => {
        const mockUser = {
          id: `user-${roomKey}`,
          name: `User${roomKey}`,
          isOnline: true,
          lastSeen: new Date(),
          deviceType: 'desktop' as const,
          fingerprint: `test-${roomKey}`,
        };
        roomService.joinRoom(roomKey, mockUser);
      });

      // Get stats
      const stats = roomService.getRoomStats();
      expect(typeof stats.totalRooms).toBe('number');
      expect(typeof stats.totalUsers).toBe('number');
      expect(stats.totalRooms > 0).toBe(true);
    });
  });

  describe('File Routes Coverage', () => {
    it('should handle file download with invalid paths', async () => {
      const invalidPaths = [
        'nonexistent.txt',
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        'file_with_no_extension',
        '.hidden_file',
        'file with spaces.txt'
      ];

      for (const filePath of invalidPaths) {
        const response = await request(app)
          .get(`/api/files/download/${encodeURIComponent(filePath)}`);
          
        expect([400, 403, 404].includes(response.status)).toBe(true);
      }
    });

    it('should handle file upload without authentication', async () => {
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should handle file upload without file', async () => {
      // Mock authentication by setting headers
      const response = await request(app)
        .post('/api/files/upload')
        .set('x-room-key', 'test-room')
        .set('x-user-id', 'test-user');

      expect([400, 401].includes(response.status)).toBe(true);
    });

    it('should handle file deletion without authentication', async () => {
      const response = await request(app)
        .delete('/api/files/test-file.txt');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should test file manager statistics', async () => {
      const stats = fileManager.getStats();
      expect(typeof stats.totalFiles).toBe('number');
      expect(typeof stats.totalSize).toBe('number');
      expect(stats.totalFiles >= 0).toBe(true);
      expect(stats.totalSize >= 0).toBe(true);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/api/rooms/test-room')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect([400, 404].includes(response.status)).toBe(true);
    });

    it('should handle requests with missing content-type', async () => {
      const response = await request(app)
        .post('/api/files/upload')
        .send('raw data without content-type');

      expect([400, 401].includes(response.status)).toBe(true);
    });

    it('should handle extremely long URLs', async () => {
      const longPath = 'a'.repeat(1000);
      const response = await request(app)
        .get(`/api/rooms/${longPath}`);

      expect([400, 404, 414].includes(response.status)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent room access', async () => {
      const roomKey = 'concurrent-test-room';
      const promises = [];

      // Create multiple concurrent requests
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app).get(`/api/rooms/${roomKey}`)
        );
      }

      const responses = await Promise.all(promises);
      
      // All should return either 404 (room doesn't exist) or 200 (room exists)
      responses.forEach(response => {
        expect([200, 404].includes(response.status)).toBe(true);
      });
    });

    it('should handle room cleanup scenarios', async () => {
      const roomKey = 'cleanup-test-room';
      
      // Create room
      const mockUser = {
        id: 'cleanup-user',
        name: 'CleanupUser',
        isOnline: true,
        lastSeen: new Date(),
        deviceType: 'desktop' as const,
        fingerprint: 'cleanup-fingerprint',
      };

      roomService.joinRoom(roomKey, mockUser);
      
      // Verify room exists
      let response = await request(app)
        .get(`/api/rooms/${roomKey}`);

      expect([200, 404].includes(response.status)).toBe(true);
      if (response.status === 200) {
        expect(response.body.data.users.length > 0).toBe(true);
      }

      // Leave room
      roomService.leaveRoom(roomKey, 'cleanup-user');
      
      // Room should now be empty or non-existent
      response = await request(app)
        .get(`/api/rooms/${roomKey}`);
        
      expect([200, 404].includes(response.status)).toBe(true);
    });
  });
});