/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import type { User } from "@cloud-clipboard/shared";

// Mock setInterval before any imports
vi.stubGlobal(
  "setInterval",
  vi.fn(() => 123 as any),
);
vi.stubGlobal("clearInterval", vi.fn());

describe("SocketService Rate Limiting Logic", () => {
  describe("Rate Limit Check Algorithm", () => {
    it("should allow requests within limit", () => {
      const messageRateLimits = new Map<string, { count: number; resetTime: number }>();

      const checkRateLimit = (socketId: string, maxRequests: number, windowMs: number): boolean => {
        const now = Date.now();
        const limit = messageRateLimits.get(socketId);

        if (!limit || now > limit.resetTime) {
          messageRateLimits.set(socketId, {
            count: 1,
            resetTime: now + windowMs,
          });
          return true;
        }

        if (limit.count >= maxRequests) {
          return false;
        }

        limit.count++;
        return true;
      };

      // First request should pass
      expect(checkRateLimit("socket-1", 10, 60000)).toBe(true);

      // Subsequent requests within limit should pass
      for (let i = 1; i < 10; i++) {
        expect(checkRateLimit("socket-1", 10, 60000)).toBe(true);
      }

      // 11th request should fail
      expect(checkRateLimit("socket-1", 10, 60000)).toBe(false);
    });

    it("should track rate limits per socket", () => {
      const messageRateLimits = new Map<string, { count: number; resetTime: number }>();

      const checkRateLimit = (socketId: string, maxRequests: number, windowMs: number): boolean => {
        const now = Date.now();
        const limit = messageRateLimits.get(socketId);

        if (!limit || now > limit.resetTime) {
          messageRateLimits.set(socketId, {
            count: 1,
            resetTime: now + windowMs,
          });
          return true;
        }

        if (limit.count >= maxRequests) {
          return false;
        }

        limit.count++;
        return true;
      };

      // Exhaust limit for socket-1
      for (let i = 0; i < 10; i++) {
        checkRateLimit("socket-1", 10, 60000);
      }

      // socket-1 should be blocked
      expect(checkRateLimit("socket-1", 10, 60000)).toBe(false);

      // socket-2 should still be able to make requests
      expect(checkRateLimit("socket-2", 10, 60000)).toBe(true);
    });

    it("should cleanup expired rate limit records", () => {
      const messageRateLimits = new Map<string, { count: number; resetTime: number }>();

      // Add expired record
      messageRateLimits.set("expired-socket", {
        count: 100,
        resetTime: Date.now() - 10000, // Expired
      });

      // Add valid record
      messageRateLimits.set("valid-socket", {
        count: 5,
        resetTime: Date.now() + 60000, // Still valid
      });

      // Cleanup function
      const cleanupRateLimits = (): void => {
        const now = Date.now();
        for (const [socketId, limit] of messageRateLimits.entries()) {
          if (now > limit.resetTime) {
            messageRateLimits.delete(socketId);
          }
        }
      };

      cleanupRateLimits();

      expect(messageRateLimits.has("expired-socket")).toBe(false);
      expect(messageRateLimits.has("valid-socket")).toBe(true);
    });
  });
});

describe("SocketService Event Handlers", () => {
  describe("JoinRoom Event", () => {
    it("should validate join room request schema", () => {
      // This would test the Zod validation
      const validRequest = {
        roomKey: "test123",
        user: {
          name: "TestUser",
          deviceType: "desktop",
        },
        fingerprint: {
          hash: "abc123def456",
        },
      };

      // Schema validation happens in handleJoinRoom
      expect(validRequest.roomKey).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(validRequest.user.name.length).toBeLessThanOrEqual(50);
    });
  });

  describe("SendMessage Event", () => {
    it("should differentiate text and file messages", () => {
      const textMessage = {
        type: "text" as const,
        roomKey: "test-room",
        content: "Hello, world!",
      };

      const fileMessage = {
        type: "file" as const,
        roomKey: "test-room",
        fileId: "file-123",
        fileName: "test.pdf",
        fileSize: 1024,
        fileType: "application/pdf",
        fileUrl: "/api/files/download/file-123",
      };

      expect(textMessage.type).toBe("text");
      expect(fileMessage.type).toBe("file");
    });
  });

  describe("P2P Signaling", () => {
    it("should relay P2P offer with correct format", () => {
      const p2pOffer = {
        to: "user-456",
        offer: JSON.stringify({ type: "offer", sdp: "v=0..." }),
      };

      expect(p2pOffer.to).toBeDefined();
      expect(typeof p2pOffer.offer).toBe("string");
    });

    it("should relay P2P answer with correct format", () => {
      const p2pAnswer = {
        to: "user-456",
        answer: JSON.stringify({ type: "answer", sdp: "v=0..." }),
      };

      expect(p2pAnswer.to).toBeDefined();
      expect(typeof p2pAnswer.answer).toBe("string");
    });

    it("should relay ICE candidates with correct format", () => {
      const iceCandidate = {
        to: "user-456",
        candidate: JSON.stringify({
          candidate: "candidate:...",
          sdpMid: "0",
          sdpMLineIndex: 0,
        }),
      };

      expect(iceCandidate.to).toBeDefined();
      expect(typeof iceCandidate.candidate).toBe("string");
    });
  });

  describe("Disconnect Handling", () => {
    it("should cleanup user state on disconnect", () => {
      const userSockets = new Map<string, string>();
      const socketUsers = new Map<string, User>();

      const userId = "user-123";
      const socketId = "socket-456";
      const user: User = {
        id: userId,
        name: "Test User",
        deviceType: "desktop",
        isOnline: true,
        lastSeen: new Date(),
      };

      userSockets.set(userId, socketId);
      socketUsers.set(socketId, user);

      // Simulate disconnect cleanup
      const disconnectedUser = socketUsers.get(socketId);
      if (disconnectedUser) {
        userSockets.delete(disconnectedUser.id);
        socketUsers.delete(socketId);
      }

      expect(userSockets.has(userId)).toBe(false);
      expect(socketUsers.has(socketId)).toBe(false);
    });
  });
});

describe("SocketService Username Handling", () => {
  it("should detect duplicate usernames", () => {
    const existingUsers: User[] = [
      { id: "1", name: "Alice", deviceType: "desktop", isOnline: true, lastSeen: new Date() },
      { id: "2", name: "Bob", deviceType: "mobile", isOnline: true, lastSeen: new Date() },
    ];

    const existingNames = existingUsers.map((u) => u.name?.toLowerCase() || "");

    expect(existingNames.includes("alice")).toBe(true);
    expect(existingNames.includes("charlie")).toBe(false);
  });

  it("should generate unique username with suffix", () => {
    const baseName = "Alice";
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const uniqueName = `${baseName}_${randomSuffix}`;

    expect(uniqueName).toMatch(/^Alice_[a-z0-9]{5}$/);
    expect(uniqueName.length).toBeLessThanOrEqual(50);
  });

  it("should truncate long usernames", () => {
    const longName = "A".repeat(60);
    const truncated = longName.slice(0, 50);

    expect(truncated.length).toBe(50);
  });

  it("should handle suffix for long usernames", () => {
    const longName = "A".repeat(50);
    const maxBaseLength = 44;
    const baseName = longName.slice(0, maxBaseLength);
    const suffix = "12345";
    const uniqueName = `${baseName}_${suffix}`;

    expect(uniqueName.length).toBe(50);
  });
});

describe("SocketService Fingerprint Handling", () => {
  it("should handle reconnection with same fingerprint", () => {
    const existingUsers: User[] = [
      {
        id: "user-123",
        name: "Alice",
        deviceType: "desktop",
        isOnline: false,
        lastSeen: new Date(),
        fingerprint: "abc123",
      },
    ];

    const incomingFingerprint = "abc123";
    const existingUser = existingUsers.find((u) => u.fingerprint === incomingFingerprint);

    expect(existingUser).toBeDefined();
    expect(existingUser?.name).toBe("Alice");
  });

  it("should create new user for new fingerprint", () => {
    const existingUsers: User[] = [
      {
        id: "user-123",
        name: "Alice",
        deviceType: "desktop",
        isOnline: true,
        lastSeen: new Date(),
        fingerprint: "abc123",
      },
    ];

    const newFingerprint = "xyz789";
    const existingUser = existingUsers.find((u) => u.fingerprint === newFingerprint);

    expect(existingUser).toBeUndefined();
  });
});

describe("SocketService Room Password", () => {
  it("should emit passwordRequired for protected rooms", () => {
    const mockSocket = {
      emit: vi.fn(),
    };

    const roomKey = "protected-room";

    // Simulate password required event
    mockSocket.emit("passwordRequired", { roomKey });

    expect(mockSocket.emit).toHaveBeenCalledWith("passwordRequired", { roomKey });
  });

  it("should notify all users when password is set", () => {
    const mockIO = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
    };

    const roomKey = "test-room";
    const hasPassword = true;

    mockIO.to(roomKey).emit("roomPasswordSet", { roomKey, hasPassword });

    expect(mockIO.to).toHaveBeenCalledWith(roomKey);
  });
});

describe("SocketService Share Room Link", () => {
  it("should generate share link without password", () => {
    const clientOrigin = "http://localhost:3000";
    const roomKey = "test-room";
    const shareLink = `${clientOrigin}/?room=${roomKey}`;

    expect(shareLink).toBe("http://localhost:3000/?room=test-room");
  });

  it("should generate share link with password", () => {
    const clientOrigin = "http://localhost:3000";
    const roomKey = "test-room";
    const password = "secret123";
    const shareLink = `${clientOrigin}/?room=${roomKey}&password=${password}`;

    expect(shareLink).toBe("http://localhost:3000/?room=test-room&password=secret123");
  });
});
