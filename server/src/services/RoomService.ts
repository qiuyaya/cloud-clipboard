import { RoomModel } from '../models/Room';
import type { RoomKey, User, TextMessage, FileMessage } from '@cloud-clipboard/shared';

export class RoomService {
  private rooms: Map<RoomKey, RoomModel> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
    }, 5 * 60 * 1000);
  }

  createRoom(key: RoomKey): RoomModel {
    if (this.rooms.has(key)) {
      return this.rooms.get(key)!;
    }

    const room = new RoomModel(key);
    this.rooms.set(key, room);
    return room;
  }

  getRoom(key: RoomKey): RoomModel | undefined {
    return this.rooms.get(key);
  }

  getRoomOrCreate(key: RoomKey): RoomModel {
    return this.getRoom(key) ?? this.createRoom(key);
  }

  joinRoom(key: RoomKey, user: User): RoomModel {
    const room = this.getRoomOrCreate(key);
    room.addUser(user);
    return room;
  }

  leaveRoom(key: RoomKey, userId: string): boolean {
    const room = this.getRoom(key);
    if (!room) return false;

    const removed = room.removeUser(userId);
    
    if (room.isEmpty()) {
      this.rooms.delete(key);
    }

    return removed;
  }

  addMessage(key: RoomKey, message: TextMessage | FileMessage): boolean {
    const room = this.getRoom(key);
    if (!room) return false;

    room.addMessage(message);
    return true;
  }

  getUsersInRoom(key: RoomKey): User[] {
    const room = this.getRoom(key);
    return room ? room.getUserList() : [];
  }

  getMessagesInRoom(key: RoomKey, limit?: number): (TextMessage | FileMessage)[] {
    const room = this.getRoom(key);
    return room ? room.getMessages(limit) : [];
  }

  updateUserStatus(key: RoomKey, userId: string, isOnline: boolean): void {
    const room = this.getRoom(key);
    if (room) {
      room.updateUserStatus(userId, isOnline);
    }
  }

  getRoomStats(): { totalRooms: number; totalUsers: number } {
    let totalUsers = 0;
    
    for (const room of this.rooms.values()) {
      totalUsers += room.getUserList().length;
    }

    return {
      totalRooms: this.rooms.size,
      totalUsers,
    };
  }

  private cleanupInactiveRooms(): void {
    const now = new Date();
    const inactiveThreshold = 24 * 60 * 60 * 1000;

    for (const [key, room] of this.rooms.entries()) {
      const timeSinceLastActivity = now.getTime() - room.lastActivity.getTime();
      
      if (timeSinceLastActivity > inactiveThreshold || room.isEmpty()) {
        this.rooms.delete(key);
        console.log(`Cleaned up inactive room: ${key}`);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}