import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import request from 'supertest';
import { Server } from 'http';
import express from 'express';
import { RoomService } from './services/RoomService';
import { FileManager } from './services/FileManager';
import { createRoomRoutes } from './routes/rooms';
import { createFileRoutes } from './routes/files';
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

  describe('Error Handling', () => {
    it('should handle malformed JSON requests', async () => {
      await request(app)
        .post('/api/rooms/test/messages')
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should handle oversized requests', async () => {
      const largeData = 'x'.repeat(11 * 1024 * 1024); // 11MB > 10MB limit
      
      await request(app)
        .post('/api/rooms/test/messages')
        .send({ content: largeData })
        .expect(413); // Request Entity Too Large
    });
  });
});