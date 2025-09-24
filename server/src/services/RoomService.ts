import { RoomModel } from "../models/Room";
import type {
  RoomKey,
  User,
  TextMessage,
  FileMessage,
  RoomPassword,
} from "@cloud-clipboard/shared";
import { EventEmitter } from "events";

export class RoomService extends EventEmitter {
  private rooms: Map<RoomKey, RoomModel> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupInactiveRooms();
      },
      5 * 60 * 1000,
    );
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

  joinRoomWithPassword(
    key: RoomKey,
    user: User,
    password: RoomPassword,
  ): { success: boolean; room?: RoomModel; error?: string } {
    const room = this.getRoom(key);

    if (!room) {
      return { success: false, error: "Room not found" };
    }

    if (!room.hasPassword()) {
      return { success: false, error: "Room does not require a password" };
    }

    if (!room.validatePassword(password)) {
      return { success: false, error: "Invalid password" };
    }

    room.addUser(user);
    return { success: true, room };
  }

  setRoomPassword(key: RoomKey, password?: RoomPassword): boolean {
    const room = this.getRoom(key);
    if (!room) return false;

    room.setPassword(password);
    return true;
  }

  isRoomPasswordProtected(key: RoomKey): boolean {
    const room = this.getRoom(key);
    return room ? room.hasPassword() : false;
  }

  leaveRoom(key: RoomKey, userId: string): boolean {
    const room = this.getRoom(key);
    if (!room) return false;

    const removed = room.removeUser(userId);

    // Check if room should be destroyed
    this.checkRoomDestruction(key, room);

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

      // Check if room should be destroyed after status update
      if (!isOnline) {
        this.checkRoomDestruction(key, room);
      }
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

  private checkRoomDestruction(key: RoomKey, room: RoomModel): void {
    // Check if all users are offline or room is empty
    const onlineUsers = room.getOnlineUsers();

    if (onlineUsers.length === 0) {
      console.log(`Room ${key} has no online users - destroying room`);
      this.rooms.delete(key);

      // Emit event for file cleanup
      this.emit("roomDestroyed", key);
    }
  }

  private cleanupInactiveRooms(): void {
    const now = new Date();
    const inactiveThreshold = 24 * 60 * 60 * 1000;

    for (const [key, room] of this.rooms.entries()) {
      const timeSinceLastActivity = now.getTime() - room.lastActivity.getTime();

      if (timeSinceLastActivity > inactiveThreshold) {
        console.log(`Cleaned up inactive room after 24h: ${key}`);
        this.rooms.delete(key);
        this.emit("roomDestroyed", key);
      } else {
        // Also check for rooms with no online users during cleanup
        this.checkRoomDestruction(key, room);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
