import type { z } from 'zod';
import {
  RoomKeySchema,
  MessageTypeSchema,
  UserSchema,
  TextMessageSchema,
  FileMessageSchema,
  FileInfoSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  UserListMessageSchema,
  WebSocketMessageSchema,
  APIResponseSchema,
  P2PConnectionSchema,
  RoomInfoSchema,
  BrowserFingerprintSchema,
} from './schemas';

export type RoomKey = z.infer<typeof RoomKeySchema>;
export type MessageType = z.infer<typeof MessageTypeSchema>;
export type User = z.infer<typeof UserSchema>;
export type TextMessage = z.infer<typeof TextMessageSchema>;
export type FileMessage = z.infer<typeof FileMessageSchema>;
export type FileInfo = z.infer<typeof FileInfoSchema>;
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;
export type LeaveRoomRequest = z.infer<typeof LeaveRoomRequestSchema>;
export type UserListMessage = z.infer<typeof UserListMessageSchema>;
export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;
export type BrowserFingerprint = z.infer<typeof BrowserFingerprintSchema>;
export type APIResponse<T = unknown> = Omit<z.infer<typeof APIResponseSchema>, 'data'> & {
  data?: T;
};
export type P2PConnection = z.infer<typeof P2PConnectionSchema>;
export type RoomInfo = z.infer<typeof RoomInfoSchema>;

export interface ServerToClientEvents {
  message: (message: WebSocketMessage) => void;
  userJoined: (user: User) => void;
  userLeft: (userId: string) => void;
  userList: (users: User[]) => void;
  error: (error: string) => void;
  systemMessage: (message: { type: 'file_deleted' | 'room_destroyed' | 'file_expired'; data: any }) => void;
  roomDestroyed: (data: { roomKey: string; deletedFiles: string[] }) => void;
  p2pOffer: (data: { from: string; offer: string }) => void;
  p2pAnswer: (data: { from: string; answer: string }) => void;
  p2pIceCandidate: (data: { from: string; candidate: string }) => void;
}

export interface ClientToServerEvents {
  joinRoom: (data: JoinRoomRequest) => void;
  leaveRoom: (data: LeaveRoomRequest) => void;
  sendMessage: (message: TextMessage | FileMessage) => void;
  requestUserList: (roomKey: RoomKey) => void;
  p2pOffer: (data: { to: string; offer: string }) => void;
  p2pAnswer: (data: { to: string; answer: string }) => void;
  p2pIceCandidate: (data: { to: string; candidate: string }) => void;
}

export interface Room {
  key: RoomKey;
  users: Map<string, User>;
  messages: (TextMessage | FileMessage)[];
  createdAt: Date;
  lastActivity: Date;
}

export interface ClipboardItem {
  id: string;
  type: 'text' | 'file';
  content?: string;
  fileInfo?: FileInfo;
  timestamp: Date;
  sender: User;
}