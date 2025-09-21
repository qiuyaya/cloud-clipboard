import type {
  Room,
  User,
  TextMessage,
  FileMessage,
  RoomKey,
  RoomPassword,
} from '@cloud-clipboard/shared';

export class RoomModel implements Room {
  key: RoomKey;
  users: Map<string, User>;
  messages: (TextMessage | FileMessage)[];
  createdAt: Date;
  lastActivity: Date;
  password?: RoomPassword;
  private maxMessages = 100;

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
    
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
    
    this.updateActivity();
  }

  getMessages(limit = 50): (TextMessage | FileMessage)[] {
    return this.messages.slice(-limit);
  }

  getUserList(): User[] {
    return Array.from(this.users.values());
  }

  isEmpty(): boolean {
    return this.users.size === 0;
  }

  getOnlineUsers(): User[] {
    return Array.from(this.users.values()).filter(user => user.isOnline);
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