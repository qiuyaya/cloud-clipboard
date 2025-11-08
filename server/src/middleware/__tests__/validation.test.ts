import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../validation";
import type { Request, Response, NextFunction } from "express";

// Mock express types
const createMockRes = (): Response => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
  return res;
};

const createMockNext = (): NextFunction => {
  return vi.fn() as NextFunction;
};

const createMockReq = (body?: any, query?: any, params?: any): Request => {
  return {
    body: body || {},
    query: query || {},
    params: params || {},
  } as unknown as Request;
};

const testSchema = z.object({
  name: z.string(),
  age: z.number(),
});

describe("Validation Middleware", () => {
  describe("validateBody", () => {
    it("should call next() when validation succeeds", () => {
      const req = createMockReq({ name: "John", age: 30 });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateBody(testSchema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should return 400 when validation fails with ZodError", () => {
      const req = createMockReq({ name: "John", age: "invalid" });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateBody(testSchema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Validation error",
          data: expect.arrayContaining([]),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 500 when non-Zod error occurs", () => {
      const req = createMockReq({ name: "John", age: 30 });
      const res = createMockRes();
      const next = createMockNext();

      // Mock schema.parse to throw non-Zod error
      const originalParse = testSchema.parse;
      testSchema.parse = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const middleware = validateBody(testSchema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Internal server error",
      });
      expect(next).not.toHaveBeenCalled();

      // Restore original
      testSchema.parse = originalParse;
    });

    it("should validate and transform the request body", () => {
      const req = createMockReq({ name: "Jane", age: 25 });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateBody(testSchema);
      middleware(req, res, next);

      expect(req.body).toEqual({ name: "Jane", age: 25 });
      expect(next).toHaveBeenCalled();
    });
  });

  describe("validateQuery", () => {
    const querySchema = z.object({
      page: z.coerce.number(),
      limit: z.coerce.number().optional(),
    });

    it("should call next() when query validation succeeds", () => {
      const req = createMockReq(undefined, { page: "1", limit: "10" });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateQuery(querySchema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should return 400 when query validation fails", () => {
      const req = createMockReq(undefined, { page: "invalid" });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateQuery(querySchema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Query validation error",
          data: expect.arrayContaining([]),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 500 when non-Zod error occurs during query validation", () => {
      const req = createMockReq(undefined, { page: "1" });
      const res = createMockRes();
      const next = createMockNext();

      const originalParse = querySchema.parse;
      querySchema.parse = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const middleware = validateQuery(querySchema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Internal server error",
      });
      expect(next).not.toHaveBeenCalled();

      querySchema.parse = originalParse;
    });

    it("should coerce and validate query parameters", () => {
      const req = createMockReq(undefined, { page: "2" });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateQuery(querySchema);
      middleware(req, res, next);

      expect(req.query).toEqual({ page: 2 });
      expect(next).toHaveBeenCalled();
    });
  });

  describe("validateParams", () => {
    const paramsSchema = z.object({
      roomId: z.string(),
    });

    it("should call next() when params validation succeeds", () => {
      const req = createMockReq(undefined, undefined, { roomId: "room123" });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateParams(paramsSchema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should return 400 when params validation fails", () => {
      const req = createMockReq(undefined, undefined, { roomId: 123 });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateParams(paramsSchema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Parameter validation error",
          data: expect.arrayContaining([]),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 500 when non-Zod error occurs during params validation", () => {
      const req = createMockReq(undefined, undefined, { roomId: "room123" });
      const res = createMockRes();
      const next = createMockNext();

      const originalParse = paramsSchema.parse;
      paramsSchema.parse = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const middleware = validateParams(paramsSchema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Internal server error",
      });
      expect(next).not.toHaveBeenCalled();

      paramsSchema.parse = originalParse;
    });

    it("should validate and transform request parameters", () => {
      const req = createMockReq(undefined, undefined, { roomId: "room456" });
      const res = createMockRes();
      const next = createMockNext();

      const middleware = validateParams(paramsSchema);
      middleware(req, res, next);

      expect(req.params).toEqual({ roomId: "room456" });
      expect(next).toHaveBeenCalled();
    });
  });
});
