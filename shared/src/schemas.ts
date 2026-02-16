import { z } from "zod";
import { SafeTextContentSchema, sanitizeUsername } from "./utils/sanitize";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_USERNAME_LENGTH,
  ROOM_KEY_MIN_LENGTH,
  ROOM_KEY_MAX_LENGTH,
} from "./constants/app";

export const RoomKeySchema = z
  .string()
  .min(ROOM_KEY_MIN_LENGTH, `Room key must be at least ${ROOM_KEY_MIN_LENGTH} characters`)
  .max(ROOM_KEY_MAX_LENGTH, `Room key must not exceed ${ROOM_KEY_MAX_LENGTH} characters`)
  .regex(/^[a-zA-Z0-9_-]+$/, "Room key can only contain letters, numbers, underscores, and hyphens")
  .refine((key) => {
    // Ensure some complexity: must contain both letters and numbers
    const hasLetter = /[a-zA-Z]/.test(key);
    const hasNumber = /[0-9]/.test(key);
    return hasLetter && hasNumber;
  }, "Room key must contain both letters and numbers");

export const MessageTypeSchema = z.enum([
  "text",
  "file",
  "join_room",
  "leave_room",
  "user_list",
  "ping",
  "pong",
]);

export const BrowserFingerprintSchema = z.object({
  userAgent: z.string(),
  language: z.string(),
  timezone: z.string(),
  screen: z.string(),
  colorDepth: z.number(),
  cookieEnabled: z.boolean(),
  doNotTrack: z.string().optional(),
  hash: z.string(), // Generated hash of all fingerprint data
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .max(MAX_USERNAME_LENGTH, `Name must not exceed ${MAX_USERNAME_LENGTH} characters`)
    .regex(/^[a-zA-Z0-9\s._\u4e00-\u9fff-]+$/, "Name contains invalid characters")
    .refine((name) => {
      const trimmed = name.trim();
      return trimmed.length > 0 && trimmed === name;
    }, "Name cannot start or end with whitespace")
    .transform((name) => sanitizeUsername(name)) // 自动清理用户名
    .optional(),
  isOnline: z.boolean(),
  lastSeen: z.date(),
  deviceType: z.enum(["mobile", "desktop", "tablet", "unknown"]),
  fingerprint: z
    .string()
    .min(8, "Fingerprint too short")
    .max(128, "Fingerprint too long")
    .optional(), // Browser fingerprint hash for user identification
});

export const TextMessageSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("text"),
  content: SafeTextContentSchema, // 使用安全的文本内容验证器
  sender: UserSchema,
  timestamp: z.date(),
  roomKey: RoomKeySchema,
});

export const FileInfoSchema = z.object({
  name: z
    .string()
    .min(1, "File name is required")
    .max(255, "File name too long")
    .refine((name) => {
      return !name.includes("..") && !name.includes("/") && !name.includes("\\");
    }, "File name contains invalid path characters"),
  size: z
    .number()
    .min(0, "File size cannot be negative")
    .max(MAX_FILE_SIZE_BYTES, `File size cannot exceed ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`),
  type: z.string().min(1, "File type is required").max(100, "File type too long"),
  lastModified: z
    .number()
    .min(0, "Last modified timestamp invalid")
    .refine(
      (val) => val <= Date.now() + 86400000,
      "Last modified timestamp cannot be in the future",
    ), // Allow 24h clock skew
});

export const FileMessageSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("file"),
  fileInfo: FileInfoSchema,
  sender: UserSchema,
  timestamp: z.date(),
  roomKey: RoomKeySchema,
  isP2P: z.boolean().optional(),
  downloadUrl: z.string().url().optional(),
  fileId: z.string().min(1).optional(),
});

export const JoinRoomRequestSchema = z.object({
  type: z.literal("join_room"),
  roomKey: RoomKeySchema,
  user: UserSchema.omit({ id: true, isOnline: true, lastSeen: true }),
  fingerprint: BrowserFingerprintSchema.optional(),
});

export const LeaveRoomRequestSchema = z.object({
  type: z.literal("leave_room"),
  roomKey: RoomKeySchema,
  userId: z.string().uuid(),
});

export const UserListMessageSchema = z.object({
  type: z.literal("user_list"),
  users: z.array(UserSchema),
  roomKey: RoomKeySchema,
});

export const RoomPasswordSchema = z.string().uuid("Room password must be a valid UUID");

export const SetRoomPasswordRequestSchema = z.object({
  type: z.literal("set_room_password"),
  roomKey: RoomKeySchema,
  password: z
    .union([
      RoomPasswordSchema,
      z.literal(""), // Allow empty string to trigger server-side password generation
    ])
    .optional(), // null/undefined to remove password
});

export const JoinRoomWithPasswordRequestSchema = z.object({
  type: z.literal("join_room_with_password"),
  roomKey: RoomKeySchema,
  password: RoomPasswordSchema,
  user: UserSchema.omit({ id: true, isOnline: true, lastSeen: true }),
  fingerprint: BrowserFingerprintSchema.optional(),
});

export const ShareRoomLinkRequestSchema = z.object({
  type: z.literal("share_room_link"),
  roomKey: RoomKeySchema,
});

export const PinRoomRequestSchema = z.object({
  type: z.literal("pin_room"),
  roomKey: RoomKeySchema,
  pinned: z.boolean(),
});

export const WebSocketMessageSchema = z.discriminatedUnion("type", [
  TextMessageSchema,
  FileMessageSchema,
  JoinRoomRequestSchema,
  JoinRoomWithPasswordRequestSchema,
  LeaveRoomRequestSchema,
  UserListMessageSchema,
  SetRoomPasswordRequestSchema,
  ShareRoomLinkRequestSchema,
  z.object({ type: z.literal("ping"), timestamp: z.date() }),
  z.object({ type: z.literal("pong"), timestamp: z.date() }),
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
  hasPassword: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  createdBy: z.string().optional(),
});

// Share-related schemas
export const SharedFileSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string().min(1).max(255),
  fileSize: z.number().min(1).max(MAX_FILE_SIZE_BYTES),
  mimeType: z.string(),
  uploadTimestamp: z.date(),
  uploadedBy: z.string(),
  storagePath: z.string(),
  checksum: z.string().length(64), // SHA-256 hex
});

export const ShareLinkSchema = z.object({
  shareId: z.string().min(8).max(10), // base62 encoded UUID
  fileId: z.string().uuid(),
  createdAt: z.date(),
  expiresAt: z.date(),
  passwordHash: z.string().nullable().optional(),
  accessCount: z.number().int().min(0),
  lastAccessedAt: z.date().nullable().optional(),
  isActive: z.boolean(),
  createdBy: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const ShareAccessLogSchema = z.object({
  shareId: z.string(),
  timestamp: z.date(),
  ipAddress: z.string(),
  userAgent: z.string().max(500).optional(),
  success: z.boolean(),
  errorCode: z
    .enum(["expired", "invalid", "wrong_password", "file_not_found", "revoked"])
    .nullable()
    .optional(),
  bytesTransferred: z.number().int().min(0).optional(),
});
