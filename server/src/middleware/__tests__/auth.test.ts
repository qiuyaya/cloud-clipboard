import { describe, it, expect, beforeEach } from "vitest";
import { authenticateRoom, optionalRoomAuth } from "../auth";
import type { Request, Response } from "express";

describe("Auth Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let responseData: any;
  let statusCode: number;

  beforeEach(() => {
    responseData = {};
    statusCode = 200;

    mockRequest = {
      headers: {},
      body: {},
      query: {},
    };

    mockResponse = {
      status: (code: number) => {
        statusCode = code;
        return mockResponse as Response;
      },
      json: (data: any) => {
        responseData = data;
        return mockResponse as Response;
      },
    };

    // nextFunction defined in each test
  });

  describe("authenticateRoom", () => {
    it("should extract room key from header and call next", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      mockRequest.headers = {
        "x-room-key": "testroom123",
      };

      authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.roomKey).toBe("testroom123");
      expect(nextCalled).toBe(true);
    });

    it("should extract room key from body and call next", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      mockRequest.body = {
        roomKey: "testroom456",
      };

      authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.roomKey).toBe("testroom456");
      expect(nextCalled).toBe(true);
    });

    it("should extract room key from query and call next", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      mockRequest.query = {
        roomKey: "testroom789",
      };

      authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.roomKey).toBe("testroom789");
      expect(nextCalled).toBe(true);
    });

    it("should prioritize header over body and query", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      mockRequest.headers = { "x-room-key": "header123" };
      mockRequest.body = { roomKey: "body456" };
      mockRequest.query = { roomKey: "query789" };

      authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.roomKey).toBe("header123");
      expect(nextCalled).toBe(true);
    });

    it("should return 401 when room key is missing", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusCode).toBe(401);
      expect(responseData).toEqual({
        success: false,
        message: "Room key is required",
      });
      expect(nextCalled).toBe(false);
    });

    it("should return 401 for invalid room key format", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      // Invalid room key (too short, no numbers)
      mockRequest.headers = {
        "x-room-key": "abc",
      };

      authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusCode).toBe(401);
      expect(responseData).toEqual({
        success: false,
        message: "Invalid room key format",
      });
      expect(nextCalled).toBe(false);
    });

    it("should validate room key format correctly", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      // Valid room key format (6-50 chars, alphanumeric with underscores/hyphens, contains letters and numbers)
      const validRoomKeys = ["testroom123", "room_123", "test-room-456", "myroom123test"];

      validRoomKeys.forEach((roomKey) => {
        nextCalled = false;
        mockRequest.headers = { "x-room-key": roomKey };

        authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

        expect(nextCalled).toBe(true);
        expect(mockRequest.roomKey).toBe(roomKey);
      });
    });

    it("should reject invalid room key formats", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      const invalidRoomKeys = [
        "abc", // too short
        "onlyletters", // no numbers
        "123456", // no letters
        "room@123", // invalid character
        "a".repeat(51), // too long
        "", // empty
        "room 123", // space
      ];

      invalidRoomKeys.forEach((roomKey) => {
        nextCalled = false;
        statusCode = 200;
        mockRequest.headers = { "x-room-key": roomKey };

        authenticateRoom(mockRequest as Request, mockResponse as Response, mockNext);

        expect(statusCode).toBe(401);
        expect(nextCalled).toBe(false);
      });
    });
  });

  describe("optionalRoomAuth", () => {
    it("should call next when room key is valid", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      mockRequest.headers = {
        "x-room-key": "testroom123",
      };

      optionalRoomAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.roomKey).toBe("testroom123");
      expect(nextCalled).toBe(true);
    });

    it("should call next when room key is missing", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      optionalRoomAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.roomKey).toBeUndefined();
      expect(nextCalled).toBe(true);
    });

    it("should continue with invalid room key format", () => {
      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      mockRequest.headers = {
        "x-room-key": "invalid",
      };

      optionalRoomAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(nextCalled).toBe(true);
      expect(mockRequest.roomKey).toBeUndefined();
    });
  });
});
