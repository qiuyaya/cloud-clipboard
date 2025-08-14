import { Server as SocketIOServer } from 'socket.io';
import type { Server } from 'http';
import { RoomService } from './RoomService';
import { log } from '../utils/logger';
import {
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  TextMessageSchema,
  FileMessageSchema,
  generateUserId,
  generateUserIdFromFingerprint,
  detectDeviceType,
} from '@cloud-clipboard/shared';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  User,
  JoinRoomRequest,
  LeaveRoomRequest,
  TextMessage,
  FileMessage,
} from '@cloud-clipboard/shared';
import type { FileManager } from './FileManager';

export class SocketService {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private userSockets: Map<string, string> = new Map(); // userId -> socketId
  private socketUsers: Map<string, User> = new Map(); // socketId -> user
  private messageRateLimits: Map<string, { count: number; resetTime: number }> = new Map(); // socketId -> rate limit data

  constructor(server: Server, private roomService: RoomService, private fileManager?: FileManager) {
    // Use same CORS configuration as main server
    const allowedOrigins = process.env.CLIENT_URL 
      ? process.env.CLIENT_URL.split(',')
      : ['http://localhost:3000', 'http://localhost:3002'];

    this.io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupSocketHandlers();
    
    // Clean up rate limit data every 5 minutes
    setInterval(() => {
      this.cleanupRateLimits();
    }, 5 * 60 * 1000);
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
    this.io.on('connection', (socket) => {
      log.info('Client connected', { socketId: socket.id, address: socket.handshake.address }, 'SocketService');

      socket.on('joinRoom', (data: JoinRoomRequest) => {
        log.debug('JoinRoom event received', { socketId: socket.id, data }, 'SocketService');
        if (this.checkRateLimit(socket.id, 5, 60000)) { // 5 joins per minute
          log.debug('Rate limit check passed for join room', { socketId: socket.id }, 'SocketService');
          this.handleJoinRoom(socket, data);
        } else {
          log.warn('Rate limit exceeded for join room', { socketId: socket.id }, 'SocketService');
          socket.emit('error', 'Too many join attempts. Please wait.');
        }
      });

      socket.on('leaveRoom', (data: LeaveRoomRequest) => {
        if (this.checkRateLimit(socket.id, 10, 60000)) { // 10 leaves per minute
          this.handleLeaveRoom(socket, data);
        } else {
          socket.emit('error', 'Too many leave attempts. Please wait.');
        }
      });

      socket.on('sendMessage', (message: TextMessage | FileMessage) => {
        if (this.checkRateLimit(socket.id, 30, 60000)) { // 30 messages per minute
          this.handleSendMessage(socket, message);
        } else {
          socket.emit('error', 'Too many messages. Please wait.');
        }
      });

      socket.on('requestUserList', (roomKey: string) => {
        if (this.checkRateLimit(socket.id, 20, 60000)) { // 20 user list requests per minute
          this.handleRequestUserList(socket, roomKey);
        } else {
          socket.emit('error', 'Too many requests. Please wait.');
        }
      });

      socket.on('p2pOffer', (data: { to: string; offer: string }) => {
        this.handleP2POffer(socket, data);
      });

      socket.on('p2pAnswer', (data: { to: string; answer: string }) => {
        this.handleP2PAnswer(socket, data);
      });

      socket.on('p2pIceCandidate', (data: { to: string; candidate: string }) => {
        this.handleP2PIceCandidate(socket, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private handleJoinRoom(socket: any, data: JoinRoomRequest): void {
    try {
      log.debug('handleJoinRoom called', {
        socketId: socket.id,
        roomKey: data.roomKey,
        userName: data.user?.name,
        userDevice: data.user?.deviceType,
        hasFingerprint: !!data.fingerprint,
        fingerprintHash: data.fingerprint?.hash?.substring(0, 16) + '...'
      }, 'SocketService');
      
      log.debug('Validating join room data with schema', {}, 'SocketService');
      const validatedData = JoinRoomRequestSchema.parse(data);
      log.debug('Join room data validation passed', {}, 'SocketService');
      const existingUsers = this.roomService.getUsersInRoom(validatedData.roomKey);
      
      // Generate user ID based on fingerprint for consistent identity
      let userId: string;
      let fingerprint: string | undefined;
      
      if (validatedData.fingerprint) {
        fingerprint = validatedData.fingerprint.hash;
        userId = generateUserIdFromFingerprint(fingerprint);
        
        // Check if this user (fingerprint) already exists in the room
        const existingUser = existingUsers.find(u => u.fingerprint === fingerprint);
        if (existingUser) {
          // User is reconnecting - reuse existing user but update online status
          existingUser.isOnline = true;
          existingUser.lastSeen = new Date();
          
          // Update socket mappings
          this.userSockets.set(existingUser.id, socket.id);
          this.socketUsers.set(socket.id, existingUser);
          
          socket.join(validatedData.roomKey);
          
          // Update user in room service
          this.roomService.updateUserStatus(validatedData.roomKey, existingUser.id, true);
          
          // Send the user their own info
          console.log(`📤 [Server] Sending userJoined event to ${socket.id}:`, existingUser);
          socket.emit('userJoined', existingUser);
          socket.emit('userList', this.roomService.getUsersInRoom(validatedData.roomKey));
          
          // Notify others about the reconnection
          socket.to(validatedData.roomKey).emit('userList', this.roomService.getUsersInRoom(validatedData.roomKey));
          
          console.log(`🔄 [Server] User ${existingUser.name} reconnected to room ${validatedData.roomKey}`);
          return;
        }
      } else {
        // Fallback to random ID if no fingerprint
        userId = generateUserId();
      }
      
      // Check for duplicate names and generate unique name if needed
      let uniqueName = validatedData.user.name;
      const existingNames = existingUsers.filter(u => u.fingerprint !== fingerprint).map(u => u.name.toLowerCase());
      
      // Only add suffix if name conflicts with OTHER users (different fingerprint)
      if (existingNames.includes(uniqueName.toLowerCase())) {
        // Generate random suffix until we find a unique name, keeping within 50 char limit
        let attempts = 0;
        const maxBaseLength = 44; // Leave room for "_" + 5 char suffix
        const baseName = validatedData.user.name.slice(0, maxBaseLength);
        
        do {
          const randomSuffix = Math.random().toString(36).substring(2, 7); // 5 chars
          uniqueName = `${baseName}_${randomSuffix}`;
          attempts++;
        } while (existingNames.includes(uniqueName.toLowerCase()) && attempts < 10);
      } else {
        // Ensure name doesn't exceed 50 characters
        uniqueName = validatedData.user.name.slice(0, 50);
      }
      
      // Create new user
      const user: User = {
        id: userId,
        name: uniqueName,
        deviceType: validatedData.user.deviceType || detectDeviceType(socket.handshake.headers['user-agent'] || ''),
        isOnline: true,
        lastSeen: new Date(),
        fingerprint,
      };

      console.log(`🏠 [Server] Adding user to room service:`, user);
      const room = this.roomService.joinRoom(validatedData.roomKey, user);
      
      console.log(`🔗 [Server] Adding socket ${socket.id} to room ${validatedData.roomKey}`);
      socket.join(validatedData.roomKey);
      this.userSockets.set(user.id, socket.id);
      this.socketUsers.set(socket.id, user);
      

      // Send the user their own info first
      console.log(`📤 [Server] Sending userJoined event to new user ${socket.id}:`, user);
      socket.emit('userJoined', user);
      socket.emit('userList', room.getUserList());
      
      // Notify others in the room
      console.log(`📢 [Server] Notifying other users in room about new user:`, user.name);
      socket.to(validatedData.roomKey).emit('userJoined', user);
      socket.to(validatedData.roomKey).emit('userList', room.getUserList());

      console.log(`✅ [Server] User ${user.name} successfully joined room ${validatedData.roomKey}`);
    } catch (error) {
      console.error('Join room error:', error);
      
      // Send more specific error information
      let errorMessage = 'Failed to join room';
      if (error && typeof error === 'object' && 'issues' in error) {
        const zodError = error as any;
        if (zodError.issues && zodError.issues.length > 0) {
          errorMessage = `Validation failed: ${zodError.issues[0].message} (${zodError.issues[0].path.join('.')})`;
        }
      } else if (error instanceof Error) {
        errorMessage = `Failed to join room: ${error.message}`;
      }
      
      socket.emit('error', errorMessage);
    }
  }

  private handleLeaveRoom(socket: any, data: LeaveRoomRequest): void {
    try {
      const validatedData = LeaveRoomRequestSchema.parse(data);
      
      const user = this.socketUsers.get(socket.id);
      if (!user) return;

      socket.leave(validatedData.roomKey);
      this.roomService.leaveRoom(validatedData.roomKey, validatedData.userId);
      
      socket.to(validatedData.roomKey).emit('userLeft', validatedData.userId);

      console.log(`User ${user.name} left room ${validatedData.roomKey}`);
    } catch (error) {
      console.error('Leave room error:', error);
      socket.emit('error', 'Failed to leave room');
    }
  }

  private handleSendMessage(socket: any, message: TextMessage | FileMessage): void {
    try {
      const user = this.socketUsers.get(socket.id);
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }

      let validatedMessage: TextMessage | FileMessage;
      
      if (message.type === 'text') {
        validatedMessage = TextMessageSchema.parse({
          ...message,
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
      
      socket.to(message.roomKey).emit('message', validatedMessage);
      socket.emit('message', validatedMessage);

      console.log(`Message sent in room ${message.roomKey} by ${user.name}`);
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', 'Failed to send message');
    }
  }

  private handleRequestUserList(socket: any, roomKey: string): void {
    try {
      const users = this.roomService.getUsersInRoom(roomKey);
      socket.emit('userList', users);
    } catch (error) {
      console.error('Request user list error:', error);
      socket.emit('error', 'Failed to get user list');
    }
  }

  private handleP2POffer(socket: any, data: { to: string; offer: string }): void {
    try {
      const fromUser = this.socketUsers.get(socket.id);
      if (!fromUser) return;

      const toSocketId = this.userSockets.get(data.to);
      if (toSocketId) {
        this.io.to(toSocketId).emit('p2pOffer', {
          from: fromUser.id,
          offer: data.offer,
        });
      }
    } catch (error) {
      console.error('P2P offer error:', error);
    }
  }

  private handleP2PAnswer(socket: any, data: { to: string; answer: string }): void {
    try {
      const fromUser = this.socketUsers.get(socket.id);
      if (!fromUser) return;

      const toSocketId = this.userSockets.get(data.to);
      if (toSocketId) {
        this.io.to(toSocketId).emit('p2pAnswer', {
          from: fromUser.id,
          answer: data.answer,
        });
      }
    } catch (error) {
      console.error('P2P answer error:', error);
    }
  }

  private handleP2PIceCandidate(socket: any, data: { to: string; candidate: string }): void {
    try {
      const fromUser = this.socketUsers.get(socket.id);
      if (!fromUser) return;

      const toSocketId = this.userSockets.get(data.to);
      if (toSocketId) {
        this.io.to(toSocketId).emit('p2pIceCandidate', {
          from: fromUser.id,
          candidate: data.candidate,
        });
      }
    } catch (error) {
      console.error('P2P ICE candidate error:', error);
    }
  }

  private handleDisconnect(socket: any): void {
    const user = this.socketUsers.get(socket.id);
    if (user) {
      this.userSockets.delete(user.id);
      this.socketUsers.delete(socket.id);
      
      const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);
      
      rooms.forEach(roomKey => {
        this.roomService.updateUserStatus(roomKey, user.id, false);
        socket.to(roomKey).emit('userLeft', user.id);
      });

      console.log(`Client disconnected: ${socket.id}`);
    }
  }

  getIO(): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
    return this.io;
  }

  // Send system message to room about file operations
  sendSystemMessage(roomKey: string, message: { type: 'file_deleted' | 'room_destroyed' | 'file_expired'; data: any }): void {
    this.io.to(roomKey).emit('systemMessage', message);
  }
}