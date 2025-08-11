import { z } from 'zod';

export const RoomKeySchema = z.string().min(1, 'Room key is required');

export const MessageTypeSchema = z.enum([
  'text',
  'file',
  'join_room',
  'leave_room',
  'user_list',
  'ping',
  'pong',
]);

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  isOnline: z.boolean(),
  lastSeen: z.date(),
  deviceType: z.enum(['mobile', 'desktop', 'tablet', 'unknown']),
});

export const TextMessageSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('text'),
  content: z.string().max(100000),
  sender: UserSchema,
  timestamp: z.date(),
  roomKey: RoomKeySchema,
});

export const FileInfoSchema = z.object({
  name: z.string().min(1),
  size: z.number().min(0),
  type: z.string(),
  lastModified: z.number(),
});

export const FileMessageSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('file'),
  fileInfo: FileInfoSchema,
  sender: UserSchema,
  timestamp: z.date(),
  roomKey: RoomKeySchema,
  isP2P: z.boolean().optional(),
  downloadUrl: z.string().url().optional(),
});

export const JoinRoomRequestSchema = z.object({
  type: z.literal('join_room'),
  roomKey: RoomKeySchema,
  user: UserSchema.omit({ id: true, isOnline: true, lastSeen: true }),
});

export const LeaveRoomRequestSchema = z.object({
  type: z.literal('leave_room'),
  roomKey: RoomKeySchema,
  userId: z.string().uuid(),
});

export const UserListMessageSchema = z.object({
  type: z.literal('user_list'),
  users: z.array(UserSchema),
  roomKey: RoomKeySchema,
});

export const WebSocketMessageSchema = z.discriminatedUnion('type', [
  TextMessageSchema,
  FileMessageSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  UserListMessageSchema,
  z.object({ type: z.literal('ping'), timestamp: z.date() }),
  z.object({ type: z.literal('pong'), timestamp: z.date() }),
]);

export const APIResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

export const P2PConnectionSchema = z.object({
  peerId: z.string(),
  isInitiator: z.boolean(),
  offer: z.string().optional(),
  answer: z.string().optional(),
  iceCandidate: z.string().optional(),
});

export const RoomInfoSchema = z.object({
  key: RoomKeySchema,
  users: z.array(UserSchema),
  messageCount: z.number().min(0),
  createdAt: z.date(),
  lastActivity: z.date(),
});