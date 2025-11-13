import { Request, Response, NextFunction } from "express";

// Check if we're in test mode
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST_WORKER_ID !== undefined;

// Simple in-memory rate limiter
interface RateLimitData {
  count: number;
  resetTime: number;
}

class SimpleRateLimiter {
  private requests: Map<string, RateLimitData> = new Map();

  constructor(
    private windowMs: number,
    public readonly maxRequests: number,
    public readonly message: string = "Too many requests",
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const data = this.requests.get(key);

    if (!data || now > data.resetTime) {
      // Reset or create
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (data.count < this.maxRequests) {
      data.count++;
      return true;
    }

    return false;
  }

  getRemainingRequests(key: string): number {
    const data = this.requests.get(key);
    if (!data) return this.maxRequests;
    return Math.max(0, this.maxRequests - data.count);
  }

  getResetTime(key: string): number {
    const data = this.requests.get(key);
    if (!data) return Date.now() + this.windowMs;
    return data.resetTime;
  }
}

// Concurrent download tracker
class ConcurrentLimitTracker {
  private concurrentCounts: Map<string, number> = new Map();

  increment(key: string): boolean {
    const count = this.concurrentCounts.get(key) || 0;
    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || "5");

    if (count >= maxConcurrent) {
      return false;
    }

    this.concurrentCounts.set(key, count + 1);
    return true;
  }

  decrement(key: string): void {
    const count = this.concurrentCounts.get(key) || 0;

    if (count <= 1) {
      this.concurrentCounts.delete(key);
    } else {
      this.concurrentCounts.set(key, count - 1);
    }
  }

  getCount(key: string): number {
    return this.concurrentCounts.get(key) || 0;
  }

  getMaxConcurrent(): number {
    return parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || "5");
  }
}

// Export singleton instance of concurrent tracker
export const concurrentDownloadTracker = new ConcurrentLimitTracker();

// Rate limiters for different endpoints
const createShareLimiter = new SimpleRateLimiter(
  60 * 1000, // 1 minute
  10, // 10 requests per minute
  "Too many share creation attempts. Please try again later.",
);

const downloadShareLimiter = new SimpleRateLimiter(
  60 * 1000, // 1 minute
  100, // 100 downloads per minute
  "Too many download attempts. Please try again later.",
);

const listShareLimiter = new SimpleRateLimiter(
  60 * 1000, // 1 minute
  30, // 30 list requests per minute
  "Too many list requests. Please try again later.",
);

const revokeShareLimiter = new SimpleRateLimiter(
  60 * 1000, // 1 minute
  20, // 20 revoke requests per minute
  "Too many revoke attempts. Please try again later.",
);

const accessLogsLimiter = new SimpleRateLimiter(
  60 * 1000, // 1 minute
  50, // 50 access log requests per minute
  "Too many access log requests. Please try again later.",
);

const publicDownloadLimiter = new SimpleRateLimiter(
  60 * 1000, // 1 minute
  parseInt(process.env.PUBLIC_DOWNLOAD_RATE_LIMIT || "20"), // Configurable rate limit, default 20
  "Too many public download attempts. Please try again later.",
);

// Middleware factory
export function createRateLimitMiddleware(limiter: SimpleRateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting in test mode
    if (isTest) {
      return next();
    }

    const key = req.ip || req.connection.remoteAddress || "unknown";
    const allowed = limiter.check(key);

    if (!allowed) {
      const resetTime = limiter.getResetTime(key);
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);

      res.setHeader("Retry-After", retryAfter.toString());
      res.setHeader("X-RateLimit-Limit", limiter.maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

      return res.status(429).json({
        success: false,
        error: "RATE_LIMIT_EXCEEDED",
        message: limiter.message,
        retryAfter,
      });
    }

    // Add rate limit headers
    res.setHeader("X-RateLimit-Limit", limiter.maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", limiter.getRemainingRequests(key).toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(limiter.getResetTime(key) / 1000).toString());

    next();
  };
}

// Export middleware functions
export const rateLimitCreateShare = createRateLimitMiddleware(createShareLimiter);
export const rateLimitDownloadShare = createRateLimitMiddleware(downloadShareLimiter);
export const rateLimitListShare = createRateLimitMiddleware(listShareLimiter);
export const rateLimitRevokeShare = createRateLimitMiddleware(revokeShareLimiter);
export const rateLimitAccessLogs = createRateLimitMiddleware(accessLogsLimiter);
export const rateLimitPublicDownload = createRateLimitMiddleware(publicDownloadLimiter);

// Also export the limiter instances for testing
export {
  createShareLimiter,
  downloadShareLimiter,
  listShareLimiter,
  revokeShareLimiter,
  accessLogsLimiter,
  publicDownloadLimiter,
};
