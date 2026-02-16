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
      this.isPinned = false;
      this.createdBy = undefined;

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
      this.pin = vi.fn(function (this: any) {
        this.isPinned = true;
      });
      this.unpin = vi.fn(function (this: any) {
        this.isPinned = false;
      });
      this.setCreator = vi.fn(function (this: any, fingerprint: string) {
        if (!this.createdBy) {
          this.createdBy = fingerprint;
        }
      });

      return this;
    }),
  };
});

// Mock setInterval and clearInterval
const mockSetInterval = vi.fn(() => {
  return 123 as any;
});
const mockClearInterval = vi.fn();

vi.spyOn(global, "setInterval").mockImplementation(mockSetInterval as any);
vi.spyOn(global, "clearInterval").mockImplementation(mockClearInterval as any);

describe("RoomService", () => {
  let roomService: RoomService;

  beforeEach(() => {
    vi.clearAllMocks();
    roomService = new RoomService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should set up cleanup interval", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");

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

  describe("addUserToRoom", () => {
    it("should add user to existing room", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: true,
      };

      const createdRoom = roomService.createRoom("testroom");
      roomService.addUserToRoom("testroom", user);

      expect(createdRoom.addUser).toHaveBeenCalledWith(user);
    });

    it("should do nothing for non-existent room", () => {
      const user: User = {
        id: randomUUID(),
        name: "TestUser",
        deviceType: "desktop",
        fingerprint: "fp1",
        lastSeen: new Date(),
        isOnline: true,
      };

      // Should not throw
      roomService.addUserToRoom("nonexistent", user);
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
      (testRoom.hasPassword as any).mockReturnValue(true);

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
      (testRoom.removeUser as any).mockReturnValue(true);

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
      (testRoom.getUserList as any).mockReturnValue([
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
      (testRoom.getMessages as any).mockReturnValue([
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
      (testRoom.getMessages as any).mockReturnValue([
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
    it.skip("should return correct statistics", () => {
      const room1 = roomService.createRoom("room1");
      (room1.getUserList as any).mockReturnValue([{ id: "u1" } as any, { id: "u2" } as any]);

      const room2 = roomService.createRoom("room2");
      (room2.getUserList as any).mockReturnValue([{ id: "u3" } as any]);

      const stats = roomService.getRoomStats();

      expect(stats.totalRooms).toBe(2);
      expect(stats.totalUsers).toBe(3);
    });
  });

  describe("checkRoomDestruction", () => {
    it("should destroy room when all users are offline", () => {
      const testRoom = roomService.createRoom("testroom");
      (testRoom.getOnlineUsers as any).mockReturnValue([]);

      roomService["checkRoomDestruction"]("testroom", testRoom);

      expect(roomService.getRoom("testroom")).toBeUndefined();
    });

    it("should not destroy room when users are online", () => {
      const testRoom = roomService.createRoom("testroom");
      (testRoom.getOnlineUsers as any).mockReturnValue([{ id: "user1" } as any]);

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
      (testRoom.getOnlineUsers as any).mockReturnValue([{ id: "user1" } as any]);

      roomService["cleanupInactiveRooms"]();

      expect(roomService.getRoom("active")).toBeDefined();
    });
  });

  describe("forceCleanup", () => {
    it.skip("should trigger cleanup and return statistics", () => {
      const room1 = roomService.createRoom("room1");
      room1.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000);

      const room2 = roomService.createRoom("room2");
      room2.lastActivity = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
      (room2.getOnlineUsers as any).mockReturnValue([{ id: "user1" } as any]);

      const result = roomService.forceCleanup();

      expect(result.cleaned).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe("destroy", () => {
    it("should clear cleanup interval", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      roomService.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe("pinRoom", () => {
    it("should pin a room when called by any user", () => {
      const testRoom = roomService.createRoom("testroom");

      const result = roomService.pinRoom("testroom", "fp_any_user");

      expect(result.success).toBe(true);
      expect(testRoom.pin).toHaveBeenCalled();
    });

    it("should pin a room by any user (not just creator)", () => {
      const testRoom = roomService.createRoom("testroom");
      testRoom.createdBy = "fp_creator";

      // 任意用户都可以固定房间
      const result = roomService.pinRoom("testroom", "fp_other");

      expect(result.success).toBe(true);
      expect(testRoom.pin).toHaveBeenCalled();
    });

    it("should reject pin for nonexistent room", () => {
      const result = roomService.pinRoom("nonexistent", "fp_creator");

      expect(result.success).toBe(false);
    });

    it("should reject pin when limit is reached", () => {
      // Create MAX_PINNED_ROOMS pinned rooms
      for (let i = 0; i < RoomService.MAX_PINNED_ROOMS; i++) {
        roomService.createRoom(`pinned${i}`);
        roomService.pinRoom(`pinned${i}`, `fp_${i}`);
      }

      roomService.createRoom("newroom");

      const result = roomService.pinRoom("newroom", "fp_new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Maximum pinned rooms reached");
    });

    it("should return success if room is already pinned", () => {
      roomService.createRoom("testroom");
      roomService.pinRoom("testroom", "fp_user1");

      // Pinning again should succeed (idempotent)
      const result = roomService.pinRoom("testroom", "fp_user2");

      expect(result.success).toBe(true);
    });
  });

  describe("unpinRoom", () => {
    it("should unpin a room when called by any user", () => {
      const testRoom = roomService.createRoom("testroom");
      testRoom.isPinned = true;

      const result = roomService.unpinRoom("testroom", "fp_any_user");

      expect(result.success).toBe(true);
      expect(testRoom.unpin).toHaveBeenCalled();
    });

    it("should unpin a room by any user (not just creator)", () => {
      const testRoom = roomService.createRoom("testroom");
      testRoom.createdBy = "fp_creator";
      testRoom.isPinned = true;

      // 任意用户都可以取消固定房间
      const result = roomService.unpinRoom("testroom", "fp_other");

      expect(result.success).toBe(true);
      expect(testRoom.unpin).toHaveBeenCalled();
    });

    it("should return success if room is already unpinned", () => {
      const testRoom = roomService.createRoom("testroom");
      testRoom.isPinned = false;

      const result = roomService.unpinRoom("testroom", "fp_user");

      expect(result.success).toBe(true);
    });
  });

  describe("pinned room lifecycle", () => {
    it("should not destroy pinned room when all users are offline", () => {
      const testRoom = roomService.createRoom("testroom");
      testRoom.isPinned = true;
      (testRoom.getOnlineUsers as any).mockReturnValue([]);

      roomService["checkRoomDestruction"]("testroom", testRoom);

      expect(roomService.getRoom("testroom")).toBeDefined();
    });

    it("should not clean up pinned room after 24h inactivity", () => {
      const testRoom = roomService.createRoom("pinned");
      testRoom.isPinned = true;
      testRoom.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000);

      roomService["cleanupInactiveRooms"]();

      expect(roomService.getRoom("pinned")).toBeDefined();
    });

    it("should destroy unpinned room when all users are offline", () => {
      const testRoom = roomService.createRoom("testroom");
      testRoom.isPinned = false;
      (testRoom.getOnlineUsers as any).mockReturnValue([]);

      roomService["checkRoomDestruction"]("testroom", testRoom);

      expect(roomService.getRoom("testroom")).toBeUndefined();
    });

    it("should clean up unpinned room after 24h inactivity", () => {
      const testRoom = roomService.createRoom("unpinned");
      testRoom.isPinned = false;
      testRoom.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000);

      roomService["cleanupInactiveRooms"]();

      expect(roomService.getRoom("unpinned")).toBeUndefined();
    });
  });

  describe("getPinnedRoomCount", () => {
    it("should return correct count of pinned rooms", () => {
      roomService.createRoom("room1");
      roomService.pinRoom("room1", "fp_1");

      roomService.createRoom("room2");
      roomService.pinRoom("room2", "fp_2");

      roomService.createRoom("room3"); // not pinned

      const count = roomService.getPinnedRoomCount();

      expect(count).toBe(2);
    });
  });
});
