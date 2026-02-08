import { describe, it, expect } from "bun:test";
import {
  RoomKeySchema,
  MessageTypeSchema,
  UserSchema,
  TextMessageSchema,
  FileInfoSchema,
  JoinRoomRequestSchema,
  BrowserFingerprintSchema,
  WebSocketMessageSchema,
  APIResponseSchema,
  P2PConnectionSchema,
  RoomInfoSchema,
} from "../schemas";

describe("Schema Validation Tests", () => {
  describe("RoomKeySchema", () => {
    it("should accept valid room keys", () => {
      const validKeys = ["room123", "test_room-42", "MyRoom2024"];
      validKeys.forEach((key) => {
        expect(() => RoomKeySchema.parse(key)).not.toThrow();
      });
    });

    it("should reject invalid room keys", () => {
      const invalidKeys = [
        "", // too short
        "abc", // no numbers
        "123", // no letters
        "room key with spaces", // spaces not allowed
        "room@invalid", // special characters
        "a".repeat(51), // too long
      ];
      invalidKeys.forEach((key) => {
        expect(() => RoomKeySchema.parse(key)).toThrow();
      });
    });

    it("should require both letters and numbers", () => {
      expect(() => RoomKeySchema.parse("abcdef")).toThrow();
      expect(() => RoomKeySchema.parse("123456")).toThrow();
      expect(() => RoomKeySchema.parse("abc123")).not.toThrow();
    });
  });

  describe("MessageTypeSchema", () => {
    it("should accept valid message types", () => {
      const validTypes = ["text", "file", "join_room", "leave_room", "user_list", "ping", "pong"];
      validTypes.forEach((type) => {
        expect(() => MessageTypeSchema.parse(type)).not.toThrow();
      });
    });

    it("should reject invalid message types", () => {
      const invalidTypes = ["invalid", "TEXT", "message", ""];
      invalidTypes.forEach((type) => {
        expect(() => MessageTypeSchema.parse(type)).toThrow();
      });
    });
  });

  describe("UserSchema", () => {
    const validUser = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "TestUser123",
      isOnline: true,
      lastSeen: new Date(),
      deviceType: "desktop" as const,
      fingerprint: "abc123def456",
    };

    it("should accept valid users", () => {
      expect(() => UserSchema.parse(validUser)).not.toThrow();
    });

    it("should reject invalid user names", () => {
      const invalidNames = [
        "", // empty
        " TestUser", // leading whitespace
        "TestUser ", // trailing whitespace
        "Test@User", // invalid characters
        "a".repeat(51), // too long
      ];

      invalidNames.forEach((name) => {
        expect(() => UserSchema.parse({ ...validUser, name })).toThrow();
      });
    });

    it("should reject invalid UUIDs", () => {
      const invalidUuids = ["not-a-uuid", "123", "", "invalid-uuid-format"];
      invalidUuids.forEach((id) => {
        expect(() => UserSchema.parse({ ...validUser, id })).toThrow();
      });
    });

    it("should require valid device types", () => {
      const validDeviceTypes = ["mobile", "desktop", "tablet", "unknown"];
      validDeviceTypes.forEach((deviceType) => {
        expect(() => UserSchema.parse({ ...validUser, deviceType })).not.toThrow();
      });

      expect(() => UserSchema.parse({ ...validUser, deviceType: "invalid" })).toThrow();
    });
  });

  describe("TextMessageSchema", () => {
    const validTextMessage = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "text" as const,
      content: "Hello world!",
      sender: {
        id: "550e8400-e29b-41d4-a716-446655440001",
        name: "TestUser",
        isOnline: true,
        lastSeen: new Date(),
        deviceType: "desktop" as const,
      },
      timestamp: new Date(),
      roomKey: "room123",
    };

    it("should accept valid text messages", () => {
      expect(() => TextMessageSchema.parse(validTextMessage)).not.toThrow();
    });

    it("should reject messages with invalid content", () => {
      const invalidContents = [
        "", // empty
        "a".repeat(50001), // too long
        "a".repeat(10001), // line too long
        "a\n".repeat(1001).slice(0, -1), // too many lines
      ];

      invalidContents.forEach((content) => {
        expect(() => TextMessageSchema.parse({ ...validTextMessage, content })).toThrow();
      });
    });

    it("should validate content line length and count", () => {
      // Valid content with multiple lines
      const validMultiline = "Line 1\nLine 2\nLine 3";
      expect(() =>
        TextMessageSchema.parse({
          ...validTextMessage,
          content: validMultiline,
        }),
      ).not.toThrow();

      // Invalid: line too long
      const longLine = "a".repeat(10001);
      expect(() => TextMessageSchema.parse({ ...validTextMessage, content: longLine })).toThrow();

      // Invalid: too many lines
      const tooManyLines = Array(1001).fill("line").join("\n");
      expect(() =>
        TextMessageSchema.parse({ ...validTextMessage, content: tooManyLines }),
      ).toThrow();
    });
  });

  describe("FileInfoSchema", () => {
    const validFileInfo = {
      name: "test-file.txt",
      size: 1024,
      type: "text/plain",
      lastModified: Date.now() - 1000,
    };

    it("should accept valid file info", () => {
      expect(() => FileInfoSchema.parse(validFileInfo)).not.toThrow();
    });

    it("should reject invalid file names", () => {
      const invalidNames = [
        "", // empty
        "file..txt", // path traversal
        "file/path.txt", // path separator
        "file\\path.txt", // path separator
        "a".repeat(256), // too long
      ];

      invalidNames.forEach((name) => {
        expect(() => FileInfoSchema.parse({ ...validFileInfo, name })).toThrow();
      });
    });

    it("should validate file size limits", () => {
      expect(() => FileInfoSchema.parse({ ...validFileInfo, size: -1 })).toThrow();
      expect(() =>
        FileInfoSchema.parse({ ...validFileInfo, size: 100 * 1024 * 1024 + 1 }),
      ).toThrow();
      expect(() =>
        FileInfoSchema.parse({ ...validFileInfo, size: 100 * 1024 * 1024 }),
      ).not.toThrow();
    });

    it("should validate file type format", () => {
      // Any non-empty string under 100 characters is now valid
      const validTypes = [
        "text/plain",
        "image/jpeg",
        "application/pdf",
        "text@plain",
        "invalid type",
        "custom.format",
        "my-file-type_123",
      ];

      const invalidTypes = [
        "", // Empty string
        "a".repeat(101), // Too long
      ];

      validTypes.forEach((type) => {
        expect(() => FileInfoSchema.parse({ ...validFileInfo, type })).not.toThrow();
      });

      invalidTypes.forEach((type) => {
        expect(() => FileInfoSchema.parse({ ...validFileInfo, type })).toThrow();
      });
    });

    it("should validate lastModified timestamp", () => {
      const now = Date.now();
      expect(() => FileInfoSchema.parse({ ...validFileInfo, lastModified: -1 })).toThrow();
      // Use a larger offset (48 hours) to avoid race conditions with Date.now() in the schema
      expect(() =>
        FileInfoSchema.parse({
          ...validFileInfo,
          lastModified: now + 86400000 * 2,
        }),
      ).toThrow();
      expect(() => FileInfoSchema.parse({ ...validFileInfo, lastModified: now })).not.toThrow();
    });
  });

  describe("BrowserFingerprintSchema", () => {
    const validFingerprint = {
      userAgent: "Mozilla/5.0...",
      language: "en-US",
      timezone: "America/New_York",
      screen: "1920x1080",
      colorDepth: 24,
      cookieEnabled: true,
      doNotTrack: "unspecified",
      hash: "abc123def456",
    };

    it("should accept valid fingerprints", () => {
      expect(() => BrowserFingerprintSchema.parse(validFingerprint)).not.toThrow();
    });

    it("should allow optional doNotTrack", () => {
      const { doNotTrack, ...fingerprintWithoutDNT } = validFingerprint;
      expect(() => BrowserFingerprintSchema.parse(fingerprintWithoutDNT)).not.toThrow();
    });

    it("should require all mandatory fields", () => {
      const requiredFields = [
        "userAgent",
        "language",
        "timezone",
        "screen",
        "colorDepth",
        "cookieEnabled",
        "hash",
      ];

      requiredFields.forEach((field) => {
        const { [field as keyof typeof validFingerprint]: removed, ...incomplete } =
          validFingerprint;
        expect(() => BrowserFingerprintSchema.parse(incomplete)).toThrow();
      });
    });
  });

  describe("JoinRoomRequestSchema", () => {
    const validJoinRequest = {
      type: "join_room" as const,
      roomKey: "room123",
      user: {
        name: "TestUser",
        deviceType: "desktop" as const,
        fingerprint: "abc123def456",
      },
      fingerprint: {
        userAgent: "Mozilla/5.0...",
        language: "en-US",
        timezone: "America/New_York",
        screen: "1920x1080",
        colorDepth: 24,
        cookieEnabled: true,
        hash: "abc123def456",
      },
    };

    it("should accept valid join requests", () => {
      expect(() => JoinRoomRequestSchema.parse(validJoinRequest)).not.toThrow();
    });

    it("should allow optional fingerprint", () => {
      const { fingerprint, ...requestWithoutFingerprint } = validJoinRequest;
      expect(() => JoinRoomRequestSchema.parse(requestWithoutFingerprint)).not.toThrow();
    });
  });

  describe("WebSocketMessageSchema", () => {
    it("should validate discriminated union types", () => {
      const textMessage = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "text",
        content: "Hello",
        sender: {
          id: "550e8400-e29b-41d4-a716-446655440001",
          name: "TestUser",
          isOnline: true,
          lastSeen: new Date(),
          deviceType: "desktop",
        },
        timestamp: new Date(),
        roomKey: "room123",
      };

      const pingMessage = {
        type: "ping",
        timestamp: new Date(),
      };

      expect(() => WebSocketMessageSchema.parse(textMessage)).not.toThrow();
      expect(() => WebSocketMessageSchema.parse(pingMessage)).not.toThrow();
    });
  });

  describe("APIResponseSchema", () => {
    it("should accept valid API responses", () => {
      const validResponses = [
        { success: true },
        { success: false, message: "Error occurred" },
        { success: true, data: { key: "value" } },
        { success: true, message: "Success", data: [1, 2, 3] },
      ];

      validResponses.forEach((response) => {
        expect(() => APIResponseSchema.parse(response)).not.toThrow();
      });
    });

    it("should require success field", () => {
      expect(() => APIResponseSchema.parse({ message: "test" })).toThrow();
    });
  });

  describe("P2PConnectionSchema", () => {
    const validP2PConnection = {
      peerId: "peer123",
      isInitiator: true,
      offer: "offer_data",
      answer: "answer_data",
      iceCandidate: "ice_candidate_data",
    };

    it("should accept valid P2P connections", () => {
      expect(() => P2PConnectionSchema.parse(validP2PConnection)).not.toThrow();
    });

    it("should allow optional fields", () => {
      const minimal = {
        peerId: "peer123",
        isInitiator: false,
      };
      expect(() => P2PConnectionSchema.parse(minimal)).not.toThrow();
    });
  });

  describe("RoomInfoSchema", () => {
    const validRoomInfo = {
      key: "room123",
      users: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "TestUser",
          isOnline: true,
          lastSeen: new Date(),
          deviceType: "desktop" as const,
        },
      ],
      messageCount: 5,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    it("should accept valid room info", () => {
      expect(() => RoomInfoSchema.parse(validRoomInfo)).not.toThrow();
    });

    it("should validate message count is non-negative", () => {
      expect(() => RoomInfoSchema.parse({ ...validRoomInfo, messageCount: -1 })).toThrow();
      expect(() => RoomInfoSchema.parse({ ...validRoomInfo, messageCount: 0 })).not.toThrow();
    });
  });
});
