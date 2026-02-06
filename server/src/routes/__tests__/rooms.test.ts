/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createRoomRoutes } from "../rooms";
import type { User, TextMessage } from "@cloud-clipboard/shared";

// Mock RoomService
const mockRoomService = {
  createRoom: vi.fn(),
  getRoom: vi.fn(),
  getUsersInRoom: vi.fn(),
  getMessagesInRoom: vi.fn(),
  getRoomStats: vi.fn(),
};

// Mock the auth middleware
vi.mock("../../middleware/auth", () => ({
  authenticateRoom: (req: any, _res: any, next: any) => {
    req.roomKey = req.headers["x-room-key"] || req.query.roomKey;
    if (!req.roomKey) {
      return _res.status(401).json({ success: false, message: "Room key required" });
    }
    next();
  },
}));

describe("Rooms Routes", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/rooms", createRoomRoutes(mockRoomService as any));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/rooms/create", () => {
    it("should create room with valid room key", async () => {
      const mockRoom = {
        key: "test123abc",
        getUserList: () => [],
        getMessages: () => [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      mockRoomService.createRoom.mockReturnValue(mockRoom);

      const response = await request(app).post("/api/rooms/create").send({ roomKey: "test123abc" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Room created successfully");
      expect(response.body.data.key).toBe("test123abc");
      expect(mockRoomService.createRoom).toHaveBeenCalledWith("test123abc");
    });

    it("should return 400 for invalid room key format - too short", async () => {
      const response = await request(app).post("/api/rooms/create").send({ roomKey: "ab" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 for room key with special characters", async () => {
      const response = await request(app).post("/api/rooms/create").send({ roomKey: "test@#$%^&" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 for room key without letters", async () => {
      const response = await request(app).post("/api/rooms/create").send({ roomKey: "123456" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 for room key without numbers", async () => {
      const response = await request(app).post("/api/rooms/create").send({ roomKey: "abcdef" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should accept valid room key with underscore and hyphen", async () => {
      const mockRoom = {
        key: "test_room-123",
        getUserList: () => [],
        getMessages: () => [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      mockRoomService.createRoom.mockReturnValue(mockRoom);

      const response = await request(app)
        .post("/api/rooms/create")
        .send({ roomKey: "test_room-123" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should handle server errors gracefully", async () => {
      mockRoomService.createRoom.mockImplementation(() => {
        throw new Error("Database error");
      });

      const response = await request(app).post("/api/rooms/create").send({ roomKey: "test123abc" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to create room");
    });
  });

  describe("GET /api/rooms/info", () => {
    it("should require authentication", async () => {
      const response = await request(app).get("/api/rooms/info");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it("should return room info for authenticated user", async () => {
      const mockRoom = {
        key: "test123abc",
        getUserList: () => [
          { id: "1", name: "User1", deviceType: "desktop", isOnline: true, lastSeen: new Date() },
        ],
        getMessages: () => [{ id: "msg1", content: "Hello" }],
        createdAt: new Date("2024-01-01"),
        lastActivity: new Date("2024-01-02"),
      };
      mockRoomService.getRoom.mockReturnValue(mockRoom);

      const response = await request(app).get("/api/rooms/info").set("X-Room-Key", "test123abc");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.key).toBe("test123abc");
      expect(response.body.data.users).toHaveLength(1);
      expect(response.body.data.messageCount).toBe(1);
    });

    it("should return 404 for non-existent room", async () => {
      mockRoomService.getRoom.mockReturnValue(null);

      const response = await request(app)
        .get("/api/rooms/info")
        .set("X-Room-Key", "nonexistent123");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Room not found");
    });
  });

  describe("GET /api/rooms/users", () => {
    it("should require authentication", async () => {
      const response = await request(app).get("/api/rooms/users");

      expect(response.status).toBe(401);
    });

    it("should return user list for room", async () => {
      const users: User[] = [
        { id: "1", name: "Alice", deviceType: "desktop", isOnline: true, lastSeen: new Date() },
        { id: "2", name: "Bob", deviceType: "mobile", isOnline: false, lastSeen: new Date() },
      ];
      mockRoomService.getUsersInRoom.mockReturnValue(users);

      const response = await request(app).get("/api/rooms/users").set("X-Room-Key", "test123abc");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe("Alice");
      expect(response.body.data[1].name).toBe("Bob");
    });

    it("should handle empty room", async () => {
      mockRoomService.getUsersInRoom.mockReturnValue([]);

      const response = await request(app)
        .get("/api/rooms/users")
        .set("X-Room-Key", "empty-room123");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe("GET /api/rooms/messages", () => {
    it("should require authentication", async () => {
      const response = await request(app).get("/api/rooms/messages");

      expect(response.status).toBe(401);
    });

    it("should return messages without limit", async () => {
      const messages: TextMessage[] = [
        {
          id: "1",
          type: "text",
          roomKey: "test123abc",
          content: "Hello",
          sender: {
            id: "u1",
            name: "Alice",
            deviceType: "desktop",
            isOnline: true,
            lastSeen: new Date(),
          },
          timestamp: new Date(),
        },
      ];
      mockRoomService.getMessagesInRoom.mockReturnValue(messages);

      const response = await request(app)
        .get("/api/rooms/messages")
        .set("X-Room-Key", "test123abc");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it("should apply limit parameter", async () => {
      const messages: TextMessage[] = [];
      for (let i = 0; i < 5; i++) {
        messages.push({
          id: `${i}`,
          type: "text",
          roomKey: "test123abc",
          content: `Message ${i}`,
          sender: {
            id: "u1",
            name: "Alice",
            deviceType: "desktop",
            isOnline: true,
            lastSeen: new Date(),
          },
          timestamp: new Date(),
        });
      }
      mockRoomService.getMessagesInRoom.mockReturnValue(messages.slice(0, 3));

      const response = await request(app)
        .get("/api/rooms/messages?limit=3")
        .set("X-Room-Key", "test123abc");

      expect(response.status).toBe(200);
      expect(mockRoomService.getMessagesInRoom).toHaveBeenCalledWith("test123abc", 3);
    });
  });

  describe("GET /api/rooms/stats", () => {
    it("should not require authentication", async () => {
      mockRoomService.getRoomStats.mockReturnValue({
        totalRooms: 5,
        totalUsers: 10,
        activeRooms: 3,
      });

      const response = await request(app).get("/api/rooms/stats");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should return aggregated room statistics", async () => {
      const stats = {
        totalRooms: 10,
        totalUsers: 25,
        activeRooms: 7,
        messagesPerRoom: 50,
      };
      mockRoomService.getRoomStats.mockReturnValue(stats);

      const response = await request(app).get("/api/rooms/stats");

      expect(response.status).toBe(200);
      expect(response.body.data.totalRooms).toBe(10);
      expect(response.body.data.totalUsers).toBe(25);
    });
  });

  describe("POST /api/rooms/validate-user", () => {
    it("should validate existing user in room", async () => {
      const users: User[] = [
        {
          id: "1",
          name: "Alice",
          deviceType: "desktop",
          isOnline: true,
          lastSeen: new Date(),
          fingerprint: "abc123",
        },
      ];
      mockRoomService.getRoom.mockReturnValue({
        getUserList: () => users,
      });

      const response = await request(app)
        .post("/api/rooms/validate-user")
        .send({ roomKey: "test123abc", userFingerprint: "abc123" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.roomExists).toBe(true);
      expect(response.body.data.userExists).toBe(true);
      expect(response.body.data.user.name).toBe("Alice");
    });

    it("should return userExists false for non-existent fingerprint", async () => {
      const users: User[] = [
        {
          id: "1",
          name: "Alice",
          deviceType: "desktop",
          isOnline: true,
          lastSeen: new Date(),
          fingerprint: "abc123",
        },
      ];
      mockRoomService.getRoom.mockReturnValue({
        getUserList: () => users,
      });

      const response = await request(app)
        .post("/api/rooms/validate-user")
        .send({ roomKey: "test123abc", userFingerprint: "xyz789" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.roomExists).toBe(true);
      expect(response.body.data.userExists).toBe(false);
      expect(response.body.data.user).toBeNull();
    });

    it("should handle non-existent room", async () => {
      mockRoomService.getRoom.mockReturnValue(null);

      const response = await request(app)
        .post("/api/rooms/validate-user")
        .send({ roomKey: "nonexistent123", userFingerprint: "abc123" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.data.roomExists).toBe(false);
      expect(response.body.data.userExists).toBe(false);
    });

    it("should validate request body schema", async () => {
      const response = await request(app).post("/api/rooms/validate-user").send({ roomKey: "ab" }); // Too short, missing fingerprint

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/rooms/:roomKey", () => {
    it("should return room info by path parameter", async () => {
      const mockRoom = {
        key: "test123abc",
        getUserList: () => [],
        getMessages: () => [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      mockRoomService.getRoom.mockReturnValue(mockRoom);

      const response = await request(app).get("/api/rooms/test123abc");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.key).toBe("test123abc");
    });

    it("should return 404 for non-existent room", async () => {
      mockRoomService.getRoom.mockReturnValue(null);

      const response = await request(app).get("/api/rooms/nonexistent123");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Room not found");
    });
  });
});
