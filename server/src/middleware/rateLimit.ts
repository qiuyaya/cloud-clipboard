import type { Request, Response, NextFunction } from "express";
import type { APIResponse } from "@cloud-clipboard/shared";
import { HTTP_RATE_LIMITS, CLEANUP_INTERVALS } from "@cloud-clipboard/shared";

interface RateLimitRecord {
  requests: number;
  resetTime: number;
}

class RateLimiter {
  private records: Map<string, RateLimitRecord> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private keyGenerator: (req: Request) => string;

  constructor(
    windowMs: number = HTTP_RATE_LIMITS.GENERAL.WINDOW_MS,
    maxRequests: number = HTTP_RATE_LIMITS.GENERAL.MAX_REQUESTS,
    keyGenerator: (req: Request) => string = (req) => req.ip || "unknown",
  ) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.keyGenerator = keyGenerator;

    // Clean up expired records every 5 minutes
    setInterval(() => this.cleanup(), CLEANUP_INTERVALS.RATE_LIMIT_CLEANUP);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (now > record.resetTime) {
        this.records.delete(key);
      }
    }
  }

  middleware() {
    return (req: Request, res: Response<APIResponse>, next: NextFunction): void => {
      const key = this.keyGenerator(req);
      const now = Date.now();

      let record = this.records.get(key);

      // Create new record or reset if window expired
      if (!record || now > record.resetTime) {
        record = {
          requests: 0,
          resetTime: now + this.windowMs,
        };
        this.records.set(key, record);
      }

      record.requests++;

      // Set rate limit headers
      res.set({
        "X-RateLimit-Limit": this.maxRequests.toString(),
        "X-RateLimit-Remaining": Math.max(0, this.maxRequests - record.requests).toString(),
        "X-RateLimit-Reset": new Date(record.resetTime).toISOString(),
      });

      if (record.requests > this.maxRequests) {
        res.status(429).json({
          success: false,
          message: "Too many requests. Please try again later.",
        });
        return;
      }

      next();
    };
  }
}

// Different rate limiters for different endpoints
// General rate limit supports env var overrides: RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS
export const generalRateLimit = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS || "") || HTTP_RATE_LIMITS.GENERAL.WINDOW_MS,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "") || HTTP_RATE_LIMITS.GENERAL.MAX_REQUESTS,
);

export const uploadRateLimit = new RateLimiter(
  HTTP_RATE_LIMITS.UPLOAD.WINDOW_MS,
  HTTP_RATE_LIMITS.UPLOAD.MAX_REQUESTS,
);

export const authRateLimit = new RateLimiter(
  HTTP_RATE_LIMITS.AUTH.WINDOW_MS,
  HTTP_RATE_LIMITS.AUTH.MAX_REQUESTS,
);

export const strictRateLimit = new RateLimiter(
  HTTP_RATE_LIMITS.STRICT.WINDOW_MS,
  HTTP_RATE_LIMITS.STRICT.MAX_REQUESTS,
);

// IP + Room based rate limiter for room-specific actions
export const roomActionRateLimit = new RateLimiter(
  HTTP_RATE_LIMITS.ROOM_ACTION.WINDOW_MS,
  HTTP_RATE_LIMITS.ROOM_ACTION.MAX_REQUESTS,
  (req) => `${req.ip}:${req.roomKey || "no-room"}`,
);
