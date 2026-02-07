import type { z } from "zod";
import {
  RoomKeySchema,
  MessageTypeSchema,
  UserSchema,
  TextMessageSchema,
  FileMessageSchema,
  FileInfoSchema,
  JoinRoomRequestSchema,
  JoinRoomWithPasswordRequestSchema,
  LeaveRoomRequestSchema,
  UserListMessageSchema,
  WebSocketMessageSchema,
  APIResponseSchema,
  P2PConnectionSchema,
  RoomInfoSchema,
  BrowserFingerprintSchema,
  RoomPasswordSchema,
  SetRoomPasswordRequestSchema,
  ShareRoomLinkRequestSchema,
  SharedFileSchema,
  ShareLinkSchema,
  ShareAccessLogSchema,
} from "./schemas";

export type RoomKey = z.infer<typeof RoomKeySchema>;
export type MessageType = z.infer<typeof MessageTypeSchema>;
export type User = z.infer<typeof UserSchema>;
export type TextMessage = z.infer<typeof TextMessageSchema>;
export type FileMessage = z.infer<typeof FileMessageSchema>;
export type FileInfo = z.infer<typeof FileInfoSchema>;
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;
export type JoinRoomWithPasswordRequest = z.infer<typeof JoinRoomWithPasswordRequestSchema>;
export type LeaveRoomRequest = z.infer<typeof LeaveRoomRequestSchema>;
export type UserListMessage = z.infer<typeof UserListMessageSchema>;
export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;
export type BrowserFingerprint = z.infer<typeof BrowserFingerprintSchema>;
export type RoomPassword = z.infer<typeof RoomPasswordSchema>;
export type SetRoomPasswordRequest = z.infer<typeof SetRoomPasswordRequestSchema>;
export type ShareRoomLinkRequest = z.infer<typeof ShareRoomLinkRequestSchema>;
export type APIResponse<T = unknown> = Omit<z.infer<typeof APIResponseSchema>, "data"> & {
  data?: T;
};
export type P2PConnection = z.infer<typeof P2PConnectionSchema>;
export type RoomInfo = z.infer<typeof RoomInfoSchema>;
export type SharedFile = z.infer<typeof SharedFileSchema>;
export type ShareLink = z.infer<typeof ShareLinkSchema>;
export type ShareAccessLog = z.infer<typeof ShareAccessLogSchema>;

export type ShareAccessErrorCode =
  | "expired"
  | "invalid"
  | "wrong_password"
  | "file_not_found"
  | "revoked";

export interface ServerToClientEvents {
  message: (message: WebSocketMessage) => void;
  messageHistory: (messages: (TextMessage | FileMessage)[]) => void;
  userJoined: (user: User) => void;
  userLeft: (userId: string) => void;
  userList: (users: User[]) => void;
  error: (error: string) => void;
  systemMessage: (message: {
    type: "file_deleted" | "room_destroyed" | "file_expired";
    data: any;
  }) => void;
  roomDestroyed: (data: { roomKey: string; deletedFiles: string[] }) => void;
  roomPasswordSet: (data: { roomKey: string; hasPassword: boolean }) => void;
  roomLinkGenerated: (data: { roomKey: string; shareLink: string }) => void;
  passwordRequired: (data: { roomKey: string }) => void;
  p2pOffer: (data: { from: string; offer: string }) => void;
  p2pAnswer: (data: { from: string; answer: string }) => void;
  p2pIceCandidate: (data: { from: string; candidate: string }) => void;
}

export interface ClientToServerEvents {
  joinRoom: (data: JoinRoomRequest) => void;
  joinRoomWithPassword: (data: JoinRoomWithPasswordRequest) => void;
  leaveRoom: (data: LeaveRoomRequest) => void;
  sendMessage: (message: TextMessage | FileMessage) => void;
  requestUserList: (roomKey: RoomKey) => void;
  setRoomPassword: (data: SetRoomPasswordRequest) => void;
  shareRoomLink: (data: ShareRoomLinkRequest) => void;
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
  password?: RoomPassword;
}

export interface ClipboardItem {
  id: string;
  type: "text" | "file";
  content?: string;
  fileInfo?: FileInfo;
  timestamp: Date;
  sender: User;
}
