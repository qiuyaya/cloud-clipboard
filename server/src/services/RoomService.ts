import { RoomModel } from "../models/Room";
import type {
  RoomKey,
  User,
  TextMessage,
  FileMessage,
  RoomPassword,
} from "@cloud-clipboard/shared";
import { ROOM_CLEANUP_INTERVAL_MS, ROOM_INACTIVE_THRESHOLD_MS } from "@cloud-clipboard/shared";
import { EventEmitter } from "events";
import { log } from "../utils/logger";

export class RoomService extends EventEmitter {
  private rooms: Map<RoomKey, RoomModel> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private pinnedRoomCount = 0; // 性能优化：维护固定房间计数器
  static readonly MAX_PINNED_ROOMS = parseInt(process.env.MAX_PINNED_ROOMS || "50", 10);

  constructor() {
    super();
    // 优化：清理间隔从5分钟改为1分钟，更及时释放内存
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
    }, ROOM_CLEANUP_INTERVAL_MS);
  }

  createRoom(key: RoomKey, creatorFingerprint?: string): RoomModel {
    if (this.rooms.has(key)) {
      return this.rooms.get(key)!;
    }

    const room = new RoomModel(key);
    // Set creator when room is first created (验证 fingerprint 有效性)
    if (creatorFingerprint && creatorFingerprint.trim() !== "") {
      room.setCreator(creatorFingerprint);
    }
    this.rooms.set(key, room);
    return room;
  }

  getRoom(key: RoomKey): RoomModel | undefined {
    return this.rooms.get(key);
  }

  getRoomOrCreate(key: RoomKey, creatorFingerprint?: string): RoomModel {
    const existingRoom = this.getRoom(key);
    if (existingRoom) {
      return existingRoom;
    }
    return this.createRoom(key, creatorFingerprint);
  }

  addUserToRoom(key: RoomKey, user: User): void {
    const room = this.getRoom(key);
    if (room) {
      room.addUser(user);
    }
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
    // Pinned rooms are never destroyed automatically
    if (room.isPinned) {
      return;
    }

    // Check if all users are offline or room is empty
    const onlineUsers = room.getOnlineUsers();

    if (onlineUsers.length === 0) {
      log.info("Room has no online users - destroying", { roomKey: key }, "RoomService");
      this.rooms.delete(key);

      // Emit event for file cleanup
      this.emit("roomDestroyed", key);
    }
  }

  private cleanupInactiveRooms(): void {
    const now = new Date();
    const inactiveThreshold = ROOM_INACTIVE_THRESHOLD_MS;

    // 跟踪清理统计
    let cleanedRooms = 0;
    let checkedRooms = 0;

    for (const [key, room] of this.rooms.entries()) {
      checkedRooms++;

      // Pinned rooms skip 24h inactivity cleanup
      if (room.isPinned) {
        continue;
      }

      const timeSinceLastActivity = now.getTime() - room.lastActivity.getTime();

      if (timeSinceLastActivity > inactiveThreshold) {
        log.info("Cleaned up inactive room after 24h", { roomKey: key }, "RoomService");
        this.rooms.delete(key);
        this.emit("roomDestroyed", key);
        cleanedRooms++;
      } else {
        // Also check for rooms with no online users during cleanup
        this.checkRoomDestruction(key, room);
      }
    }

    if (checkedRooms > 0) {
      log.debug(
        "Room cleanup stats",
        { checked: checkedRooms, cleaned: cleanedRooms, active: this.rooms.size },
        "RoomService",
      );
    }
  }

  // 添加手动清理方法，用于压力测试
  forceCleanup(): { cleaned: number; total: number } {
    const beforeCount = this.rooms.size;
    // 触发清理逻辑但不等待
    this.cleanupInactiveRooms();
    return {
      cleaned: beforeCount - this.rooms.size,
      total: this.rooms.size,
    };
  }

  getPinnedRoomCount(): number {
    // 性能优化：直接返回计数器，避免遍历所有房间
    return this.pinnedRoomCount;
  }

  pinRoom(key: RoomKey, fingerprint: string): { success: boolean; error?: string } {
    const room = this.getRoom(key);
    if (!room) return { success: false, error: "Room not found" };

    // 验证 fingerprint 有效性
    if (!fingerprint || fingerprint.trim() === "") {
      return { success: false, error: "Invalid fingerprint" };
    }

    if (room.isPinned) {
      return { success: true }; // Already pinned
    }

    if (this.pinnedRoomCount >= RoomService.MAX_PINNED_ROOMS) {
      return { success: false, error: "Maximum pinned rooms reached" };
    }

    room.pin();
    this.pinnedRoomCount++; // 更新计数器
    return { success: true };
  }

  unpinRoom(key: RoomKey, fingerprint: string): { success: boolean; error?: string } {
    const room = this.getRoom(key);
    if (!room) return { success: false, error: "Room not found" };

    // 验证 fingerprint 有效性
    if (!fingerprint || fingerprint.trim() === "") {
      return { success: false, error: "Invalid fingerprint" };
    }

    if (!room.isPinned) {
      return { success: true }; // Already unpinned
    }

    room.unpin();
    this.pinnedRoomCount--; // 更新计数器
    return { success: true };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
