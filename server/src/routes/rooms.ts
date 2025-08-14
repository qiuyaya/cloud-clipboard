import { Router } from 'express';
import { z } from 'zod';
import { RoomService } from '../services/RoomService';
import { validateBody, validateQuery } from '../middleware/validation';
import { authenticateRoom } from '../middleware/auth';
import { RoomKeySchema } from '@cloud-clipboard/shared';
import type { RoomInfo } from '@cloud-clipboard/shared';

const router = Router();

const CreateRoomSchema = z.object({
  roomKey: RoomKeySchema,
});

// const GetRoomInfoSchema = z.object({
//   roomKey: RoomKeySchema,
// });

export const createRoomRoutes = (roomService: RoomService): Router => {
  router.post('/create', validateBody(CreateRoomSchema), (req, res) => {
    try {
      const { roomKey } = req.body;
      const room = roomService.createRoom(roomKey);
      
      const roomInfo: RoomInfo = {
        key: room.key,
        users: room.getUserList(),
        messageCount: room.getMessages().length,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
      };

      res.json({
        success: true,
        message: 'Room created successfully',
        data: roomInfo,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'Failed to create room',
      });
    }
  });

  router.get('/info', authenticateRoom, (req, res) => {
    try {
      const roomKey = req.roomKey!;
      const room = roomService.getRoom(roomKey);
      
      if (!room) {
        res.status(404).json({
          success: false,
          message: 'Room not found',
        });
        return;
      }

      const roomInfo: RoomInfo = {
        key: room.key,
        users: room.getUserList(),
        messageCount: room.getMessages().length,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
      };

      res.json({
        success: true,
        data: roomInfo,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'Failed to get room info',
      });
    }
  });

  router.get('/users', authenticateRoom, (req, res) => {
    try {
      const roomKey = req.roomKey!;
      const users = roomService.getUsersInRoom(roomKey);
      
      res.json({
        success: true,
        data: users,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'Failed to get users',
      });
    }
  });

  router.get('/messages', authenticateRoom, validateQuery(z.object({ limit: z.coerce.number().optional() })), (req, res) => {
    try {
      const roomKey = req.roomKey!;
      const { limit } = req.query;
      const messages = roomService.getMessagesInRoom(roomKey, limit);
      
      res.json({
        success: true,
        data: messages,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'Failed to get messages',
      });
    }
  });

  router.get('/stats', (req, res) => {
    try {
      const stats = roomService.getRoomStats();
      
      res.json({
        success: true,
        data: stats,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'Failed to get stats',
      });
    }
  });

  return router;
};