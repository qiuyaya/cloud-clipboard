import { Server as SocketIOServer } from "socket.io";
import type { Server } from "http";
import { RoomService } from "./RoomService";
import type { RoomModel } from "../models/Room";
import { log } from "../utils/logger";
import { randomUUID } from "crypto";
import {
  JoinRoomRequestSchema,
  JoinRoomWithPasswordRequestSchema,
  LeaveRoomRequestSchema,
  TextMessageSchema,
  FileMessageSchema,
  SetRoomPasswordRequestSchema,
  ShareRoomLinkRequestSchema,
  PinRoomRequestSchema,
  sanitizeMessageContent,
  generateUserId,
  generateUserIdFromFingerprint,
  generateDefaultUsername,
  detectDeviceType,
  SOCKET_RATE_LIMITS,
  CLEANUP_INTERVALS,
  INITIAL_MESSAGE_LIMIT,
  MAX_USERNAME_LENGTH,
} from "@cloud-clipboard/shared";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  User,
  JoinRoomRequest,
  JoinRoomWithPasswordRequest,
  LeaveRoomRequest,
  TextMessage,
  FileMessage,
  SetRoomPasswordRequest,
  ShareRoomLinkRequest,
  PinRoomRequest,
} from "@cloud-clipboard/shared";

export class SocketService {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private userSockets: Map<string, string> = new Map(); // userId -> socketId
  private socketUsers: Map<string, User> = new Map(); // socketId -> user
  private messageRateLimits: Map<string, { count: number; resetTime: number }> = new Map(); // socketId -> rate limit data

  constructor(
    server: Server,
    private roomService: RoomService,
  ) {
    // Use same CORS configuration as main server
    const allowedOrigins = process.env.CLIENT_URL
      ? process.env.CLIENT_URL.split(",")
      : ["http://localhost:3000", "http://localhost:3002"];

    // Support subpath deployment for Socket.IO
    const basePath = process.env.BASE_PATH || "/";
    const socketPath = basePath === "/" ? "/socket.io" : `${basePath}/socket.io`;

    this.io = new SocketIOServer(server, {
      path: socketPath,
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupSocketHandlers();

    // Clean up rate limit data every 5 minutes
    setInterval(() => {
      this.cleanupRateLimits();
    }, CLEANUP_INTERVALS.RATE_LIMIT_CLEANUP);
  }

  private checkRateLimit(socketId: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const limit = this.messageRateLimits.get(socketId);

    if (!limit || now > limit.resetTime) {
      // Create new window
      this.messageRateLimits.set(socketId, {
        count: 1,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (limit.count >= maxRequests) {
      return false; // Rate limit exceeded
    }

    limit.count++;
    return true;
  }

  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [socketId, limit] of this.messageRateLimits.entries()) {
      if (now > limit.resetTime) {
        this.messageRateLimits.delete(socketId);
      }
    }
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket) => {
      log.info(
        "Client connected",
        { socketId: socket.id, address: socket.handshake.address },
        "SocketService",
      );

      socket.on("joinRoom", (data: JoinRoomRequest) => {
        log.debug("JoinRoom event received", { socketId: socket.id, data }, "SocketService");
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.JOIN_ROOM.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.JOIN_ROOM.WINDOW_MS,
          )
        ) {
          log.debug(
            "Rate limit check passed for join room",
            { socketId: socket.id },
            "SocketService",
          );
          this.handleJoinRoom(socket, data);
        } else {
          log.warn("Rate limit exceeded for join room", { socketId: socket.id }, "SocketService");
          socket.emit("error", "Too many join attempts. Please wait.");
        }
      });

      socket.on("joinRoomWithPassword", (data: JoinRoomWithPasswordRequest) => {
        log.debug(
          "JoinRoomWithPassword event received",
          { socketId: socket.id, roomKey: data.roomKey },
          "SocketService",
        );
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.JOIN_ROOM.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.JOIN_ROOM.WINDOW_MS,
          )
        ) {
          this.handleJoinRoomWithPassword(socket, data);
        } else {
          socket.emit("error", "Too many join attempts. Please wait.");
        }
      });

      socket.on("leaveRoom", (data: LeaveRoomRequest) => {
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.LEAVE_ROOM.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.LEAVE_ROOM.WINDOW_MS,
          )
        ) {
          this.handleLeaveRoom(socket, data);
        } else {
          socket.emit("error", "Too many leave attempts. Please wait.");
        }
      });

      socket.on("sendMessage", (message: TextMessage | FileMessage) => {
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.SEND_MESSAGE.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.SEND_MESSAGE.WINDOW_MS,
          )
        ) {
          this.handleSendMessage(socket, message);
        } else {
          socket.emit("error", "Too many messages. Please wait.");
        }
      });

      socket.on("requestUserList", (roomKey: string) => {
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.USER_LIST.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.USER_LIST.WINDOW_MS,
          )
        ) {
          this.handleRequestUserList(socket, roomKey);
        } else {
          socket.emit("error", "Too many requests. Please wait.");
        }
      });

      socket.on("setRoomPassword", (data: SetRoomPasswordRequest) => {
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.PASSWORD_CHANGE.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.PASSWORD_CHANGE.WINDOW_MS,
          )
        ) {
          this.handleSetRoomPassword(socket, data);
        } else {
          socket.emit("error", "Too many requests. Please wait.");
        }
      });

      socket.on("shareRoomLink", (data: ShareRoomLinkRequest) => {
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.SHARE_ROOM.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.SHARE_ROOM.WINDOW_MS,
          )
        ) {
          this.handleShareRoomLink(socket, data);
        } else {
          socket.emit("error", "Too many requests. Please wait.");
        }
      });

      socket.on("pinRoom", (data: PinRoomRequest) => {
        if (
          this.checkRateLimit(
            socket.id,
            SOCKET_RATE_LIMITS.PASSWORD_CHANGE.MAX_REQUESTS,
            SOCKET_RATE_LIMITS.PASSWORD_CHANGE.WINDOW_MS,
          )
        ) {
          this.handlePinRoom(socket, data);
        } else {
          socket.emit("error", "Too many requests. Please wait.");
        }
      });

      socket.on("p2pOffer", (data: { to: string; offer: string }) => {
        this.handleP2POffer(socket, data);
      });

      socket.on("p2pAnswer", (data: { to: string; answer: string }) => {
        this.handleP2PAnswer(socket, data);
      });

      socket.on("p2pIceCandidate", (data: { to: string; candidate: string }) => {
        this.handleP2PIceCandidate(socket, data);
      });

      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private handleJoinRoom(socket: any, data: JoinRoomRequest): void {
    try {
      const validatedData = JoinRoomRequestSchema.parse(data);

      // Check if room requires password
      if (this.roomService.isRoomPasswordProtected(validatedData.roomKey)) {
        socket.emit("passwordRequired", { roomKey: validatedData.roomKey });
        return;
      }

      const room = this.roomService.getRoomOrCreate(
        validatedData.roomKey,
        validatedData.fingerprint?.hash,
      );
      this.processUserJoin(
        socket,
        validatedData.roomKey,
        validatedData.user,
        validatedData.fingerprint,
        room,
      );
    } catch (error) {
      log.error("Join room error", { error }, "SocketService");

      let errorMessage = "Failed to join room";
      if (error && typeof error === "object" && "issues" in error) {
        const zodError = error as any;
        if (zodError.issues && zodError.issues.length > 0) {
          errorMessage = `Validation failed: ${zodError.issues[0].message} (${zodError.issues[0].path.join(".")})`;
        }
      } else if (error instanceof Error) {
        errorMessage = `Failed to join room: ${error.message}`;
      }

      socket.emit("error", errorMessage);
    }
  }

  private handleJoinRoomWithPassword(socket: any, data: JoinRoomWithPasswordRequest): void {
    try {
      const validatedData = JoinRoomWithPasswordRequestSchema.parse(data);

      const room = this.roomService.getRoom(validatedData.roomKey);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      if (!room.hasPassword()) {
        socket.emit("error", "Room does not require a password");
        return;
      }

      if (!room.validatePassword(validatedData.password)) {
        socket.emit("error", "Invalid password");
        return;
      }

      this.processUserJoin(
        socket,
        validatedData.roomKey,
        validatedData.user,
        validatedData.fingerprint,
        room,
      );
    } catch (error) {
      log.error("Join room with password error", { error }, "SocketService");
      socket.emit("error", "Failed to join room with password");
    }
  }

  /**
   * 处理用户加入房间的公共逻辑：指纹检测/重连、用户名去重、User 创建、事件发送
   */
  private processUserJoin(
    socket: any,
    roomKey: string,
    userData: JoinRoomRequest["user"],
    fingerprint: { hash: string } | undefined,
    room: RoomModel,
  ): void {
    const existingUsers = room.getUserList();

    // 1. 指纹检测和重连逻辑
    let userId: string;
    let fp: string | undefined;

    if (fingerprint) {
      fp = fingerprint.hash;
      userId = generateUserIdFromFingerprint(fp);

      const existingUser = existingUsers.find((u) => u.fingerprint === fp);
      if (existingUser) {
        existingUser.isOnline = true;
        existingUser.lastSeen = new Date();

        this.userSockets.set(existingUser.id, socket.id);
        this.socketUsers.set(socket.id, existingUser);

        socket.join(roomKey);
        this.roomService.updateUserStatus(roomKey, existingUser.id, true);

        socket.emit("userJoined", existingUser);
        socket.emit("userList", room.getUserList());

        socket.emit("roomPinned", {
          roomKey,
          isPinned: !!room.isPinned,
        });

        const messages = this.roomService.getMessagesInRoom(roomKey, INITIAL_MESSAGE_LIMIT);
        if (messages.length > 0) {
          socket.emit("messageHistory", messages);
        }

        socket.to(roomKey).emit("userList", room.getUserList());

        log.info(
          "User reconnected to room",
          { userName: existingUser.name, roomKey },
          "SocketService",
        );
        return;
      }
    } else {
      userId = generateUserId();
    }

    // 2. 用户名去重
    let uniqueName = userData.name || generateDefaultUsername();
    const existingNames = existingUsers
      .filter((u) => u.fingerprint !== fp)
      .map((u) => u.name?.toLowerCase() || "")
      .filter((name) => name !== "");

    if (existingNames.includes(uniqueName.toLowerCase())) {
      let attempts = 0;
      const maxBaseLength = MAX_USERNAME_LENGTH - 6; // Leave room for "_" + 5 char suffix
      const baseName = uniqueName.slice(0, maxBaseLength);

      do {
        const randomSuffix = Math.random().toString(36).substring(2, 7);
        uniqueName = `${baseName}_${randomSuffix}`;
        attempts++;
      } while (existingNames.includes(uniqueName.toLowerCase()) && attempts < 10);
    } else {
      uniqueName = uniqueName.slice(0, MAX_USERNAME_LENGTH);
    }

    // 3. 创建 User 对象
    const user: User = {
      id: userId,
      name: uniqueName,
      deviceType:
        userData.deviceType || detectDeviceType(socket.handshake.headers["user-agent"] || ""),
      isOnline: true,
      lastSeen: new Date(),
      fingerprint: fp,
    };

    // 4. 加入房间
    room.addUser(user);
    socket.join(roomKey);
    this.userSockets.set(user.id, socket.id);
    this.socketUsers.set(socket.id, user);

    // 5. 发送事件给新用户
    socket.emit("userJoined", user);
    socket.emit("userList", room.getUserList());
    socket.emit("roomPinned", { roomKey, isPinned: !!room.isPinned });

    const messages = this.roomService.getMessagesInRoom(roomKey, INITIAL_MESSAGE_LIMIT);
    if (messages.length > 0) {
      socket.emit("messageHistory", messages);
    }

    // 6. 通知房间内其他用户
    socket.to(roomKey).emit("userJoined", user);
    socket.to(roomKey).emit("userList", room.getUserList());

    log.info("User successfully joined room", { userName: user.name, roomKey }, "SocketService");
  }

  private handleLeaveRoom(socket: any, data: LeaveRoomRequest): void {
    try {
      const validatedData = LeaveRoomRequestSchema.parse(data);

      const user = this.socketUsers.get(socket.id);
      if (!user) return;

      socket.leave(validatedData.roomKey);
      this.roomService.leaveRoom(validatedData.roomKey, validatedData.userId);

      socket.to(validatedData.roomKey).emit("userLeft", validatedData.userId);

      log.info(
        "User left room",
        { userName: user.name, roomKey: validatedData.roomKey },
        "SocketService",
      );
    } catch (error) {
      log.error("Leave room error", { error }, "SocketService");
      socket.emit("error", "Failed to leave room");
    }
  }

  private handleSendMessage(socket: any, message: TextMessage | FileMessage): void {
    try {
      const user = this.socketUsers.get(socket.id);
      if (!user) {
        socket.emit("error", "User not found");
        return;
      }

      let validatedMessage: TextMessage | FileMessage;

      if (message.type === "text") {
        // 在验证前对消息内容进行XSS过滤
        const sanitizedContent = sanitizeMessageContent(message.content);
        validatedMessage = TextMessageSchema.parse({
          ...message,
          content: sanitizedContent, // 使用过滤后的内容
          id: generateUserId(),
          sender: user,
          timestamp: new Date(),
        });
      } else {
        validatedMessage = FileMessageSchema.parse({
          ...message,
          id: generateUserId(),
          sender: user,
          timestamp: new Date(),
        });
      }

      this.roomService.addMessage(message.roomKey, validatedMessage);

      socket.to(message.roomKey).emit("message", validatedMessage);
      socket.emit("message", validatedMessage);

      log.debug(
        "Message sent in room",
        { roomKey: message.roomKey, userName: user.name, messageType: message.type },
        "SocketService",
      );
    } catch (error) {
      log.error("Send message error", { error }, "SocketService");
      socket.emit("error", "Failed to send message");
    }
  }

  private handleRequestUserList(socket: any, roomKey: string): void {
    try {
      const users = this.roomService.getUsersInRoom(roomKey);
      socket.emit("userList", users);
    } catch (error) {
      log.error("Request user list error", { error }, "SocketService");
      socket.emit("error", "Failed to get user list");
    }
  }

  private handleSetRoomPassword(socket: any, data: SetRoomPasswordRequest): void {
    try {
      const validatedData = SetRoomPasswordRequestSchema.parse(data);

      // Verify user is in the room
      const user = this.socketUsers.get(socket.id);
      if (!user) {
        socket.emit("error", "User not authenticated");
        return;
      }

      const users = this.roomService.getUsersInRoom(validatedData.roomKey);
      if (!users.find((u) => u.id === user.id)) {
        socket.emit("error", "User not in room");
        return;
      }

      // Generate password if one is being set, undefined to remove
      let password: string | undefined;
      if ("password" in validatedData) {
        // Password field is present - set password (generate if empty)
        password = validatedData.password || randomUUID();
      } else {
        // Password field is not present - remove password
        password = undefined;
      }

      const success = this.roomService.setRoomPassword(validatedData.roomKey, password);

      if (success) {
        const hasPassword = !!password;

        // Notify all users in the room
        this.io.to(validatedData.roomKey).emit("roomPasswordSet", {
          roomKey: validatedData.roomKey,
          hasPassword,
        });

        log.info(
          "Room password updated",
          {
            roomKey: validatedData.roomKey,
            hasPassword,
            userName: user.name,
          },
          "SocketService",
        );
      } else {
        socket.emit("error", "Failed to set room password");
      }
    } catch (error) {
      log.error("Set room password error", { error }, "SocketService");
      socket.emit("error", "Failed to set room password");
    }
  }

  private handleShareRoomLink(socket: any, data: ShareRoomLinkRequest): void {
    try {
      const validatedData = ShareRoomLinkRequestSchema.parse(data);

      // Verify user is in the room
      const user = this.socketUsers.get(socket.id);
      if (!user) {
        socket.emit("error", "User not authenticated");
        return;
      }

      const users = this.roomService.getUsersInRoom(validatedData.roomKey);
      if (!users.find((u) => u.id === user.id)) {
        socket.emit("error", "User not in room");
        return;
      }

      const room = this.roomService.getRoom(validatedData.roomKey);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      // Generate share link with password if room is password protected
      // Priority: PUBLIC_URL > CLIENT_URL > socket handshake headers > fallback
      const publicUrl = process.env.PUBLIC_URL;
      const clientOrigin = publicUrl
        ? publicUrl.endsWith("/")
          ? publicUrl.slice(0, -1)
          : publicUrl
        : process.env.CLIENT_URL ||
          socket.handshake.headers.origin ||
          socket.handshake.headers.referer?.split("?")[0].replace(/\/$/, "") ||
          "http://localhost:3000";
      let shareLink = `${clientOrigin}/?room=${validatedData.roomKey}`;

      if (room.hasPassword()) {
        shareLink += `&password=${room.password}`;
      }

      socket.emit("roomLinkGenerated", {
        roomKey: validatedData.roomKey,
        shareLink,
      });

      log.info(
        "Share link generated for room",
        { roomKey: validatedData.roomKey, userName: user.name },
        "SocketService",
      );
    } catch (error) {
      log.error("Share room link error", { error }, "SocketService");
      socket.emit("error", "Failed to generate share link");
    }
  }

  private handlePinRoom(socket: any, data: PinRoomRequest): void {
    try {
      const validatedData = PinRoomRequestSchema.parse(data);

      const user = this.socketUsers.get(socket.id);
      if (!user) {
        socket.emit("error", "User not authenticated");
        return;
      }

      if (!user.fingerprint) {
        socket.emit("error", "Fingerprint required for pin/unpin");
        return;
      }

      const result = validatedData.pinned
        ? this.roomService.pinRoom(validatedData.roomKey, user.fingerprint)
        : this.roomService.unpinRoom(validatedData.roomKey, user.fingerprint);

      if (!result.success) {
        socket.emit("error", result.error || "Failed to pin/unpin room");
        return;
      }

      // Broadcast to all users in the room
      this.io.to(validatedData.roomKey).emit("roomPinned", {
        roomKey: validatedData.roomKey,
        isPinned: validatedData.pinned,
      });

      log.info(
        "Room pin status updated",
        {
          roomKey: validatedData.roomKey,
          isPinned: validatedData.pinned,
          userName: user.name,
        },
        "SocketService",
      );
    } catch (error) {
      log.error("Pin room error", { error }, "SocketService");
      socket.emit("error", "Failed to pin/unpin room");
    }
  }

  private handleP2POffer(socket: any, data: { to: string; offer: string }): void {
    try {
      const fromUser = this.socketUsers.get(socket.id);
      if (!fromUser) return;

      const toSocketId = this.userSockets.get(data.to);
      if (toSocketId) {
        this.io.to(toSocketId).emit("p2pOffer", {
          from: fromUser.id,
          offer: data.offer,
        });
      }
    } catch (error) {
      log.error("P2P offer error", { error }, "SocketService");
    }
  }

  private handleP2PAnswer(socket: any, data: { to: string; answer: string }): void {
    try {
      const fromUser = this.socketUsers.get(socket.id);
      if (!fromUser) return;

      const toSocketId = this.userSockets.get(data.to);
      if (toSocketId) {
        this.io.to(toSocketId).emit("p2pAnswer", {
          from: fromUser.id,
          answer: data.answer,
        });
      }
    } catch (error) {
      log.error("P2P answer error", { error }, "SocketService");
    }
  }

  private handleP2PIceCandidate(socket: any, data: { to: string; candidate: string }): void {
    try {
      const fromUser = this.socketUsers.get(socket.id);
      if (!fromUser) return;

      const toSocketId = this.userSockets.get(data.to);
      if (toSocketId) {
        this.io.to(toSocketId).emit("p2pIceCandidate", {
          from: fromUser.id,
          candidate: data.candidate,
        });
      }
    } catch (error) {
      log.error("P2P ICE candidate error", { error }, "SocketService");
    }
  }

  private handleDisconnect(socket: any): void {
    // 立即清理该 socket 的速率限制数据，避免内存泄漏
    this.messageRateLimits.delete(socket.id);

    const user = this.socketUsers.get(socket.id);
    if (user) {
      this.userSockets.delete(user.id);
      this.socketUsers.delete(socket.id);

      const rooms = Array.from(socket.rooms).filter((room) => room !== socket.id);

      rooms.forEach((roomKey) => {
        this.roomService.updateUserStatus(roomKey as string, user.id, false);
        socket.to(roomKey).emit("userLeft", user.id);
      });

      log.info(
        "Client disconnected",
        { socketId: socket.id, userName: user.name },
        "SocketService",
      );
    }
  }

  getIO(): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
    return this.io;
  }

  // Send system message to room about file operations
  sendSystemMessage(
    roomKey: string,
    message: {
      type: "file_deleted" | "room_destroyed" | "file_expired";
      data: any;
    },
  ): void {
    this.io.to(roomKey).emit("systemMessage", message);
  }
}
