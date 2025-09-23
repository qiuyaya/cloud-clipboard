import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Server } from 'http';
import express from 'express';
import { RoomService } from '../services/RoomService';
import { FileManager } from '../services/FileManager';
import { createRoomRoutes } from '../routes/rooms';
import { createFileRoutes } from '../routes/files';
import type { APIResponse } from '@cloud-clipboard/shared';

describe('Integration Tests', () => {
  let app: express.Application;
  let server: Server;
  let roomService: RoomService;
  let fileManager: FileManager;
  const testPort = 3999;

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

    // Health endpoint
    app.get('/api/health', (_req, res: express.Response<APIResponse>) => {
      const roomStats = roomService.getRoomStats();
      const fileStats = fileManager.getStats();
      res.json({
        success: true,
        message: 'Server is healthy',
        data: {
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          ...roomStats,
          ...fileStats,
        },
      });
    });

    // API root endpoint
    app.get('/api', (_req, res: express.Response<APIResponse>) => {
      res.json({
        success: true,
        message: 'Cloud Clipboard API v1.0.0',
        data: {
          version: '1.0.0',
          endpoints: {
            rooms: '/api/rooms',
            files: '/api/files',
            health: '/api/health',
          },
        },
      });
    });

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

  describe('Health Endpoint', () => {
    it('should return server health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Server is healthy');
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.uptime).toBe('number');
      expect(typeof response.body.data.timestamp).toBe('string');
      expect(typeof response.body.data.totalRooms).toBe('number');
      expect(typeof response.body.data.totalUsers).toBe('number');
    });
  });

  describe('Room API', () => {
    it('should return 404 for non-existent room', async () => {
      const response = await request(app)
        .get('/api/rooms/nonexistent')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Room not found');
    });

    it('should create and retrieve room info', async () => {
      const roomKey = 'testroom123';
      
      // Create room by joining
      const mockUser = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'TestUser',
        isOnline: true,
        lastSeen: new Date(),
        deviceType: 'desktop' as const,
        fingerprint: 'test-fingerprint',
      };

      roomService.joinRoom(roomKey, mockUser);

      // Get room info
      const response = await request(app)
        .get(`/api/rooms/${roomKey}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.key).toBe(roomKey);
      expect(Array.isArray(response.body.data.users)).toBe(true);
      expect(response.body.data.users).toHaveLength(1);
      expect(response.body.data.users[0].name).toBe('TestUser');
      expect(response.body.data.users[0].deviceType).toBe('desktop');
      expect(typeof response.body.data.messageCount).toBe('number');
      expect(typeof response.body.data.createdAt).toBe('string');
      expect(typeof response.body.data.lastActivity).toBe('string');
    });
  });

  describe('Room API Coverage Tests', () => {
    it('should test health endpoint variations', async () => {
      // Test with different methods
      await request(app)
        .get('/api/health')
        .expect(200);
        
      await request(app)
        .head('/api/health')
        .expect(200);
    });

    it('should test file stats in health endpoint', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalFiles');
      expect(response.body.data).toHaveProperty('totalSize');
      expect(response.body.data).toHaveProperty('uptime');
      expect(response.body.data).toHaveProperty('timestamp');
    });

    it('should handle invalid file downloads', async () => {
      await request(app)
        .get('/api/files/download/nonexistent.txt')
        .expect(404);
        
      await request(app)
        .get('/api/files/download/../../../etc/passwd')
        .expect(404);
    });

    it('should handle invalid file deletions without auth', async () => {
      await request(app)
        .delete('/api/files/nonexistent.txt')
        .expect(401);
    });

    it('should test API root endpoint', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('version');
      expect(response.body.data).toHaveProperty('endpoints');
    });

    it('should test different request methods on health', async () => {
      // GET should work
      await request(app)
        .get('/api/health')
        .expect(200);

      // POST should return 404 since it's not defined
      await request(app)
        .post('/api/health')
        .expect(404);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid routes', async () => {
      await request(app)
        .get('/api/invalid-endpoint')
        .expect(404);

      await request(app)
        .post('/api/invalid-endpoint')
        .expect(404);
    });

    it('should handle malformed requests gracefully', async () => {
      // Test malformed file upload without authentication
      const response = await request(app)
        .post('/api/files/upload')
        .send('not a file');
      
      // Should return 401 for unauthorized request
      expect(response.status).toBe(401);
    });

    it('should handle large request headers', async () => {
      // Test with very large header
      const largeHeader = 'x'.repeat(10000);
      
      const response = await request(app)
        .get('/api/health')
        .set('X-Large-Header', largeHeader);
      
      // Should either succeed or return appropriate error
      expect([200, 400, 413, 431].includes(response.status)).toBe(true);
    });

    it('should handle different content types', async () => {
      // Test with various content types on health endpoint
      await request(app)
        .get('/api/health')
        .set('Accept', 'application/json')
        .expect(200);
        
      await request(app)
        .get('/api/health')
        .set('Accept', 'text/plain')
        .expect(200);
    });

    it('should test additional health endpoint data properties', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.data).toHaveProperty('roomCount');
      expect(response.body.data).toHaveProperty('totalRooms');
      expect(response.body.data).toHaveProperty('totalUsers');
      expect(typeof response.body.data.roomCount).toBe('number');
    });

    it('should test API with different user agents', async () => {
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'curl/7.68.0'
      ];

      for (const userAgent of userAgents) {
        const response = await request(app)
          .get('/api/health')
          .set('User-Agent', userAgent);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });
  });
});