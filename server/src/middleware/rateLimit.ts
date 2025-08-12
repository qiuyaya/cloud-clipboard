import type { Request, Response, NextFunction } from 'express';
import type { APIResponse } from '@cloud-clipboard/shared';

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
    windowMs: number = 15 * 60 * 1000, // 15 minutes
    maxRequests: number = 100,
    keyGenerator: (req: Request) => string = (req) => req.ip || 'unknown'
  ) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.keyGenerator = keyGenerator;

    // Clean up expired records every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
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
        'X-RateLimit-Limit': this.maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, this.maxRequests - record.requests).toString(),
        'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
      });

      if (record.requests > this.maxRequests) {
        res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
        });
        return;
      }

      next();
    };
  }
}

// Different rate limiters for different endpoints
export const generalRateLimit = new RateLimiter(
  15 * 60 * 1000, // 15 minutes
  100             // 100 requests per window
);

export const uploadRateLimit = new RateLimiter(
  60 * 1000,      // 1 minute
  5               // 5 uploads per minute
);

export const authRateLimit = new RateLimiter(
  15 * 60 * 1000, // 15 minutes
  20              // 20 auth attempts per window
);

export const strictRateLimit = new RateLimiter(
  5 * 60 * 1000,  // 5 minutes
  50              // 50 requests per 5 minutes
);

// IP + Room based rate limiter for room-specific actions
export const roomActionRateLimit = new RateLimiter(
  60 * 1000,      // 1 minute
  30,             // 30 actions per minute
  (req) => `${req.ip}:${req.roomKey || 'no-room'}`
);