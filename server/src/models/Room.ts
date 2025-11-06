import type {
  Room,
  User,
  TextMessage,
  FileMessage,
  RoomKey,
  RoomPassword,
} from "@cloud-clipboard/shared";

export class RoomModel implements Room {
  key: RoomKey;
  users: Map<string, User>;
  messages: (TextMessage | FileMessage)[];
  createdAt: Date;
  lastActivity: Date;
  password?: RoomPassword;
  // 优化：增加消息限制到1000条，并支持配置
  private maxMessages = 1000;
  // 添加统计信息
  private messageCount = 0;
  private messageDroppedCount = 0;

  constructor(key: RoomKey) {
    this.key = key;
    this.users = new Map();
    this.messages = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
  }

  addUser(user: User): void {
    this.users.set(user.id, { ...user, isOnline: true, lastSeen: new Date() });
    this.updateActivity();
  }

  removeUser(userId: string): boolean {
    const removed = this.users.delete(userId);
    if (removed) {
      this.updateActivity();
    }
    return removed;
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  updateUserStatus(userId: string, isOnline: boolean): void {
    const user = this.users.get(userId);
    if (user) {
      user.isOnline = isOnline;
      user.lastSeen = new Date();
      this.updateActivity();
    }
  }

  addMessage(message: TextMessage | FileMessage): void {
    this.messages.push(message);
    this.messageCount++;

    // 优化：高效的内存管理
    if (this.messages.length > this.maxMessages) {
      // 删除最旧的20%消息，减少频繁的shift操作
      const removeCount = Math.floor(this.maxMessages * 0.2);
      this.messages.splice(0, removeCount);
      this.messageDroppedCount += removeCount;
    }

    this.updateActivity();
  }

  getMessages(limit = 50, offset = 0): (TextMessage | FileMessage)[] {
    // 支持分页查询，优化大消息量场景
    if (offset >= this.messages.length) {
      return [];
    }
    const end = Math.min(offset + limit, this.messages.length);
    return this.messages.slice(-end - offset).slice(0, limit);
  }

  // 获取消息统计信息
  getMessageStats() {
    return {
      total: this.messages.length,
      totalProcessed: this.messageCount,
      dropped: this.messageDroppedCount,
    };
  }

  // 重置统计信息
  resetStats(): void {
    this.messageCount = 0;
    this.messageDroppedCount = 0;
  }

  getUserList(): User[] {
    return Array.from(this.users.values());
  }

  isEmpty(): boolean {
    return this.users.size === 0;
  }

  getOnlineUsers(): User[] {
    return Array.from(this.users.values()).filter((user) => user.isOnline);
  }

  setPassword(password?: RoomPassword): void {
    if (password === undefined) {
      delete this.password;
    } else {
      this.password = password;
    }
    this.updateActivity();
  }

  hasPassword(): boolean {
    return !!this.password;
  }

  validatePassword(password: RoomPassword): boolean {
    return this.password === password;
  }

  private updateActivity(): void {
    this.lastActivity = new Date();
  }
}
