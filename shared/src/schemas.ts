import { z } from "zod";

export const RoomKeySchema = z
  .string()
  .min(6, "Room key must be at least 6 characters")
  .max(50, "Room key must not exceed 50 characters")
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
    .max(50, "Name must not exceed 50 characters")
    .regex(/^[a-zA-Z0-9\s._\u4e00-\u9fff-]+$/, "Name contains invalid characters")
    .refine((name) => {
      const trimmed = name.trim();
      return trimmed.length > 0 && trimmed === name;
    }, "Name cannot start or end with whitespace")
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
  content: z
    .string()
    .min(1, "Message content is required")
    .max(50000, "Message content too long (max 50,000 characters)")
    .refine((content) => {
      // Prevent excessively long lines that could cause display issues
      const lines = content.split("\n");
      return lines.every((line) => line.length <= 10000);
    }, "Individual lines cannot exceed 10,000 characters")
    .refine((content) => {
      // Prevent too many lines
      return content.split("\n").length <= 1000;
    }, "Message cannot exceed 1,000 lines"),
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
    .max(100 * 1024 * 1024, "File size cannot exceed 100MB"),
  type: z
    .string()
    .min(1, "File type is required")
    .max(100, "File type too long")
    .regex(/^[a-zA-Z0-9/-]+$/, "Invalid file type format"),
  lastModified: z
    .number()
    .min(0, "Last modified timestamp invalid")
    .max(Date.now() + 86400000, "Last modified timestamp cannot be in the future"), // Allow 24h clock skew
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
});
