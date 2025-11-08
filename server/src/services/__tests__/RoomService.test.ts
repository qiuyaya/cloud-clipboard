/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RoomService } from "../RoomService";
import type { User, TextMessage } from "@cloud-clipboard/shared";
import { randomUUID } from "crypto";

// Mock RoomModel
vi.mock("../../models/Room", () => {
  return {
    RoomModel: vi.fn().mockImplementation(function (this: any, key: string) {
      this.key = key;
      this.createdAt = new Date();
      this.lastActivity = new Date();
      this.users = new Map();
      this.messages = [];
      this.password = undefined;

      this.addUser = vi.fn();
      this.removeUser = vi.fn();
      this.getUserList = vi.fn().mockReturnValue([]);
      this.getOnlineUsers = vi.fn().mockReturnValue([]);
      this.getMessages = vi.fn().mockReturnValue([]);
      this.addMessage = vi.fn();
      this.updateUserStatus = vi.fn();
      this.hasPassword = vi.fn().mockReturnValue(false);
      this.validatePassword = vi.fn().mockReturnValue(true);
      this.setPassword = vi.fn();
    }),
  };
});

// Mock setInterval and clearInterval
vi.stubGlobal(
  "setInterval",
  vi.fn((cb) => {
    setTimeout(() => cb(), 0);
    return 123 as any;
  }),
);
vi.stubGlobal("clearInterval", vi.fn());

describe("RoomService", () => {
  let roomService: RoomService;

  beforeEach(() => {
    vi.clearAllMocks();
    roomService = new RoomService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("should set up cleanup interval", () => {
      const setIntervalSpy = vi.fn();
      vi.stubGlobal("setInterval", setIntervalSpy);

      new RoomService();
      expect(setIntervalSpy).toHaveBeenCalled();
    });
  });

  describe("createRoom", () => {
    it("should create new room if it doesn't exist", () => {
      const room = roomService.createRoom("newroom");

      expect(room).toBeInstanceOf(Object);
      expect(roomService.getRoom("newroom")).toBeDefined();
    });

    it("should return existing room if it already exists", () => {
      const room1 = roomService.createRoom("testroom");
      const room2 = roomService.createRoom("testroom");

      expect(room1).toBe(room2);
    });
  });

  describe("getRoom", () => {
    it("should return room when it exists", () => {
      roomService.createRoom("testroom");
      const room = roomService.getRoom("testroom");

      expect(room).toBeDefined();
    });

    it("should return undefined when room doesn't exist", () => {
      const room = roomService.getRoom("nonexistent");
      expect(room).toBeUndefined();
    });
  });

  describe("getRoomOrCreate", () => {
    it("should return existing room", () => {
      roomService.createRoom("testroom");
      const room = roomService.getRoomOrCreate("testroom");

      expect(room).toBeDefined();
    });

    it("should create room if it doesn't exist", () => {
      const room = roomService.getRoomOrCreate("newroom");
      expect(room).toBeDefined();
      expect(roomService.getRoom("newroom")).toBeDefined();
    });
  });

  describe("joinRoom", () => {
    it("should add user to room", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: true,
      };

      // Get the room that was created
      const createdRoom = roomService.createRoom("testroom");
      const room = roomService.joinRoom("testroom", user);

      expect(room).toBeDefined();
      expect(createdRoom.addUser).toHaveBeenCalled();
    });
  });

  describe("joinRoomWithPassword", () => {
    it("should join room when password is correct", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: true,
      };

      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.hasPassword).mockReturnValue(true);
      vi.mocked(testRoom.validatePassword).mockReturnValue(true);

      const result = roomService.joinRoomWithPassword("testroom", user, "password123");

      expect(result.success).toBe(true);
      expect(result.room).toBeDefined();
    });

    it("should fail when room doesn't exist", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: false,
      };

      const result = roomService.joinRoomWithPassword("nonexistent", user, "password123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room not found");
    });

    it("should fail when room doesn't have password", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: false,
      };

      roomService.createRoom("testroom");

      const result = roomService.joinRoomWithPassword("testroom", user, "password123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room does not require a password");
    });

    it("should fail when password is invalid", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: true,
      };

      roomService.createRoom("testroom");
      roomService.setRoomPassword("testroom", "correctpass");

      // Mock hasPassword and validatePassword
      const testRoom = roomService.getRoom("testroom")!;
      vi.mocked(testRoom.hasPassword).mockReturnValue(true);
      vi.mocked(testRoom.validatePassword).mockReturnValue(false);

      const result = roomService.joinRoomWithPassword("testroom", user, "wrongpass");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid password");
    });
  });

  describe("setRoomPassword", () => {
    it("should set password for existing room", () => {
      roomService.createRoom("testroom");

      const result = roomService.setRoomPassword("testroom", "newpassword");

      expect(result).toBe(true);
    });

    it("should return false for non-existent room", () => {
      const result = roomService.setRoomPassword("nonexistent", "password");

      expect(result).toBe(false);
    });
  });

  describe("isRoomPasswordProtected", () => {
    it("should return true for password-protected room", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.hasPassword).mockReturnValue(true);

      const result = roomService.isRoomPasswordProtected("testroom");

      expect(result).toBe(true);
    });

    it("should return false for room without password", () => {
      roomService.createRoom("testroom");

      const result = roomService.isRoomPasswordProtected("testroom");

      expect(result).toBe(false);
    });

    it("should return false for non-existent room", () => {
      const result = roomService.isRoomPasswordProtected("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("leaveRoom", () => {
    it("should remove user from room", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.removeUser).mockReturnValue(true);

      const result = roomService.leaveRoom("testroom", "user123");

      expect(result).toBe(true);
    });

    it("should return false for non-existent room", () => {
      const result = roomService.leaveRoom("nonexistent", "user123");

      expect(result).toBe(false);
    });
  });

  describe("addMessage", () => {
    it("should add message to room", () => {
      roomService.createRoom("testroom");

      const message: TextMessage = {
        id: randomUUID(),
        type: "text",
        content: "Test message",
        sender: {
          id: "user1",
          name: "User1",
          deviceType: "desktop",
          fingerprint: "fp1",
          lastSeen: new Date(),
          isOnline: true,
        },
        timestamp: new Date(),
        roomKey: "testroom",
      };

      const result = roomService.addMessage("testroom", message);

      expect(result).toBe(true);
    });

    it("should return false for non-existent room", () => {
      const message: TextMessage = {
        id: randomUUID(),
        type: "text",
        content: "Test message",
        sender: {
          id: "user1",
          name: "User1",
          deviceType: "desktop",
          fingerprint: "fp1",
          lastSeen: new Date(),
          isOnline: true,
        },
        roomKey: "nonexistent",
        timestamp: new Date(),
      };

      const result = roomService.addMessage("nonexistent", message);

      expect(result).toBe(false);
    });
  });

  describe("getUsersInRoom", () => {
    it("should return users for existing room", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.getUserList).mockReturnValue([
        {
          id: "user1",
          name: "User1",
          deviceType: "desktop",
          fingerprint: "fp1",
          lastSeen: new Date(),
          isOnline: true,
        },
      ]);

      const users = roomService.getUsersInRoom("testroom");

      expect(users).toHaveLength(1);
    });

    it("should return empty array for non-existent room", () => {
      const users = roomService.getUsersInRoom("nonexistent");

      expect(users).toEqual([]);
    });
  });

  describe("getMessagesInRoom", () => {
    it("should return messages for existing room", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.getMessages).mockReturnValue([
        {
          id: "msg1",
          type: "text" as const,
          content: "Test message",
          sender: {
            id: "user1",
            name: "User1",
            deviceType: "desktop",
            fingerprint: "fp1",
            lastSeen: new Date(),
            isOnline: true,
          },
          roomKey: "testroom",
          timestamp: new Date(),
        },
      ]);

      const messages = roomService.getMessagesInRoom("testroom");

      expect(messages).toHaveLength(1);
    });

    it("should return empty array for non-existent room", () => {
      const messages = roomService.getMessagesInRoom("nonexistent");

      expect(messages).toEqual([]);
    });

    it("should apply limit when specified", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.getMessages).mockReturnValue([
        {
          id: "msg1",
          type: "text" as const,
          content: "Test",
          sender: {
            id: "user1",
            name: "User1",
            deviceType: "desktop",
            fingerprint: "fp1",
            lastSeen: new Date(),
            isOnline: true,
          },
          roomKey: "testroom",
          timestamp: new Date(),
        },
        {
          id: "msg2",
          type: "text" as const,
          content: "Test2",
          sender: {
            id: "user2",
            name: "User2",
            deviceType: "desktop",
            fingerprint: "fp1",
            lastSeen: new Date(),
            isOnline: true,
          },
          roomKey: "testroom",
          timestamp: new Date(),
        },
      ]);

      roomService.getMessagesInRoom("testroom", 1);

      expect(testRoom.getMessages).toHaveBeenCalledWith(1);
    });
  });

  describe("updateUserStatus", () => {
    it("should update user status in room", () => {
      const testRoom = roomService.createRoom("testroom");

      roomService.updateUserStatus("testroom", "user1", false);

      expect(testRoom.updateUserStatus).toHaveBeenCalledWith("user1", false);
    });
  });

  describe("getRoomStats", () => {
    it("should return correct statistics", () => {
      roomService.createRoom("room1");
      roomService.createRoom("room2");

      const testRoom1 = roomService.getRoom("room1")!;
      const testRoom2 = roomService.getRoom("room2")!;

      vi.mocked(testRoom1.getUserList).mockReturnValue([{ id: "u1" } as any, { id: "u2" } as any]);
      vi.mocked(testRoom2.getUserList).mockReturnValue([{ id: "u3" } as any]);

      const stats = roomService.getRoomStats();

      expect(stats.totalRooms).toBe(2);
      expect(stats.totalUsers).toBe(3);
    });
  });

  describe("checkRoomDestruction", () => {
    it("should destroy room when all users are offline", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.getOnlineUsers).mockReturnValue([]);

      roomService["checkRoomDestruction"]("testroom", testRoom);

      expect(roomService.getRoom("testroom")).toBeUndefined();
    });

    it("should not destroy room when users are online", () => {
      const testRoom = roomService.createRoom("testroom");
      vi.mocked(testRoom.getOnlineUsers).mockReturnValue([{ id: "user1" } as any]);

      roomService["checkRoomDestruction"]("testroom", testRoom);

      expect(roomService.getRoom("testroom")).toBeDefined();
    });
  });

  describe("cleanupInactiveRooms", () => {
    it("should clean up rooms inactive for 24 hours", () => {
      const testRoom = roomService.createRoom("inactive");
      testRoom.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

      roomService["cleanupInactiveRooms"]();

      expect(roomService.getRoom("inactive")).toBeUndefined();
    });

    it("should keep active rooms", () => {
      const testRoom = roomService.createRoom("active");
      testRoom.lastActivity = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
      vi.mocked(testRoom.getOnlineUsers).mockReturnValue([{ id: "user1" } as any]);

      roomService["cleanupInactiveRooms"]();

      expect(roomService.getRoom("active")).toBeDefined();
    });
  });

  describe("forceCleanup", () => {
    it("should trigger cleanup and return statistics", () => {
      const room1 = roomService.createRoom("room1");
      room1.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const room2 = roomService.createRoom("room2");
      room2.lastActivity = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
      vi.mocked(room2.getOnlineUsers).mockReturnValue([{ id: "user1" } as any]);

      const result = roomService.forceCleanup();

      expect(result.cleaned).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe("destroy", () => {
    it("should clear cleanup interval", () => {
      const clearIntervalSpy = vi.fn();
      vi.stubGlobal("clearInterval", clearIntervalSpy);

      roomService.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
