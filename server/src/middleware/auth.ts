import type { Request, Response, NextFunction } from 'express';
import { RoomKeySchema } from '@cloud-clipboard/shared';
import type { APIResponse } from '@cloud-clipboard/shared';

declare global {
  namespace Express {
    interface Request {
      roomKey?: string;
    }
  }
}

export const authenticateRoom = (req: Request, res: Response<APIResponse>, next: NextFunction): void => {
  const roomKey = req.headers['x-room-key'] as string || req.body?.roomKey || req.query?.roomKey;

  if (!roomKey) {
    res.status(401).json({
      success: false,
      message: 'Room key is required',
    });
    return;
  }

  try {
    const validatedKey = RoomKeySchema.parse(roomKey);
    req.roomKey = validatedKey;
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid room key format',
    });
  }
};

export const optionalRoomAuth = (req: Request, _res: Response<APIResponse>, next: NextFunction): void => {
  const roomKey = req.headers['x-room-key'] as string || req.body?.roomKey || req.query?.roomKey;

  if (roomKey) {
    try {
      const validatedKey = RoomKeySchema.parse(roomKey);
      req.roomKey = validatedKey;
    } catch {
      // Invalid key, but we'll continue without setting roomKey
    }
  }

  next();
};