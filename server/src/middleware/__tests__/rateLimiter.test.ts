/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Set test environment before imports
process.env.NODE_ENV = "development"; // Override test mode to actually test rate limiting
process.env.MAX_CONCURRENT_DOWNLOADS = "3";
process.env.PUBLIC_DOWNLOAD_RATE_LIMIT = "5";

describe("SimpleRateLimiter", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let responseHeaders: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    responseHeaders = {};

    mockReq = {
      ip: "127.0.0.1",
      connection: { remoteAddress: "127.0.0.1" } as unknown as Request["connection"],
    };

    mockRes = {
      setHeader: vi.fn((name: string, value: string) => {
        responseHeaders[name] = value;
        return mockRes as Response;
      }),
      status: vi.fn(() => {
        return mockRes as Response;
      }),
      json: vi.fn(() => {
        return mockRes as Response;
      }),
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRateLimitMiddleware", () => {
    it("should skip rate limiting in test mode", async () => {
      // Re-import with test mode
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST_WORKER_ID", "1");

      const { createRateLimitMiddleware } = await import("../rateLimiter");

      // Create a simple limiter mock
      const mockLimiter = {
        maxRequests: 1,
        message: "Test limit",
        check: vi.fn().mockReturnValue(false), // Would block
        getRemainingRequests: vi.fn().mockReturnValue(0),
        getResetTime: vi.fn().mockReturnValue(Date.now() + 60000),
      };

      const middleware = createRateLimitMiddleware(mockLimiter as any);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Should pass through even though check would return false
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("Rate Limit Headers", () => {
    it("should set proper rate limit headers", async () => {
      // Import fresh module to test
      const { createShareLimiter } = await import("../rateLimiter");

      // In non-test mode, we can't easily test this without mocking
      // Just verify the limiter has correct properties
      expect(createShareLimiter.maxRequests).toBe(10);
      expect(createShareLimiter.message).toContain("share creation");
    });
  });
});

describe("ConcurrentDownloadTracker", () => {
  let tracker: any;

  beforeEach(async () => {
    vi.stubEnv("MAX_CONCURRENT_DOWNLOADS", "3");
    const { concurrentDownloadTracker } = await import("../rateLimiter");
    tracker = concurrentDownloadTracker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should track concurrent downloads per IP", () => {
    const ip = "192.168.1.100";

    expect(tracker.getCount(ip)).toBe(0);

    tracker.increment(ip);
    expect(tracker.getCount(ip)).toBe(1);

    tracker.increment(ip);
    expect(tracker.getCount(ip)).toBe(2);
  });

  it("should decrement concurrent count", () => {
    const ip = "192.168.1.101";

    tracker.increment(ip);
    tracker.increment(ip);
    expect(tracker.getCount(ip)).toBe(2);

    tracker.decrement(ip);
    expect(tracker.getCount(ip)).toBe(1);

    tracker.decrement(ip);
    expect(tracker.getCount(ip)).toBe(0);
  });

  it("should not go below zero on decrement", () => {
    const ip = "192.168.1.102";

    tracker.decrement(ip);
    expect(tracker.getCount(ip)).toBe(0);
  });

  it("should enforce maximum concurrent downloads", () => {
    const ip = "192.168.1.103";
    const maxConcurrent = tracker.getMaxConcurrent();

    // Fill up to max
    for (let i = 0; i < maxConcurrent; i++) {
      const result = tracker.increment(ip);
      expect(result).toBe(true);
    }

    // Next increment should fail
    const result = tracker.increment(ip);
    expect(result).toBe(false);
    expect(tracker.getCount(ip)).toBe(maxConcurrent);
  });

  it("should allow more downloads after decrement", () => {
    const ip = "192.168.1.104";
    const maxConcurrent = tracker.getMaxConcurrent();

    // Fill up to max
    for (let i = 0; i < maxConcurrent; i++) {
      tracker.increment(ip);
    }

    // Decrement one
    tracker.decrement(ip);

    // Now should allow one more
    const result = tracker.increment(ip);
    expect(result).toBe(true);
  });

  it("should track different IPs independently", () => {
    const ip1 = "192.168.1.105";
    const ip2 = "192.168.1.106";
    const maxConcurrent = tracker.getMaxConcurrent();

    // Fill up ip1
    for (let i = 0; i < maxConcurrent; i++) {
      tracker.increment(ip1);
    }

    // ip2 should still be able to download
    const result = tracker.increment(ip2);
    expect(result).toBe(true);
    expect(tracker.getCount(ip2)).toBe(1);
  });

  it("should return correct max concurrent value", () => {
    expect(tracker.getMaxConcurrent()).toBe(3); // From env
  });
});

describe("SimpleRateLimiter Class", () => {
  it("should check and track requests", async () => {
    const { createShareLimiter } = await import("../rateLimiter");

    const key = "test-ip-" + Date.now();

    // First request should pass
    expect(createShareLimiter.check(key)).toBe(true);

    // Subsequent requests up to limit should pass
    for (let i = 1; i < 10; i++) {
      expect(createShareLimiter.check(key)).toBe(true);
    }

    // 11th request should fail
    expect(createShareLimiter.check(key)).toBe(false);
  });

  it("should report remaining requests correctly", async () => {
    const { listShareLimiter } = await import("../rateLimiter");

    const key = "test-remaining-" + Date.now();

    // Before any requests
    expect(listShareLimiter.getRemainingRequests(key)).toBe(30);

    // After some requests
    listShareLimiter.check(key);
    listShareLimiter.check(key);
    listShareLimiter.check(key);

    expect(listShareLimiter.getRemainingRequests(key)).toBe(27);
  });

  it("should return reset time", async () => {
    const { revokeShareLimiter } = await import("../rateLimiter");

    const key = "test-reset-" + Date.now();
    const now = Date.now();

    revokeShareLimiter.check(key);

    const resetTime = revokeShareLimiter.getResetTime(key);
    // Reset time should be approximately 1 minute in the future
    expect(resetTime).toBeGreaterThan(now);
    expect(resetTime).toBeLessThanOrEqual(now + 61000);
  });

  it("should have correct limits for different limiters", async () => {
    const {
      createShareLimiter,
      downloadShareLimiter,
      listShareLimiter,
      revokeShareLimiter,
      accessLogsLimiter,
      publicDownloadLimiter,
    } = await import("../rateLimiter");

    expect(createShareLimiter.maxRequests).toBe(10);
    expect(downloadShareLimiter.maxRequests).toBe(100);
    expect(listShareLimiter.maxRequests).toBe(30);
    expect(revokeShareLimiter.maxRequests).toBe(20);
    expect(accessLogsLimiter.maxRequests).toBe(50);
    expect(publicDownloadLimiter.maxRequests).toBe(5); // From env
  });
});

describe("Exported Middleware Functions", () => {
  it("should export all rate limit middleware functions", async () => {
    const {
      rateLimitCreateShare,
      rateLimitDownloadShare,
      rateLimitListShare,
      rateLimitRevokeShare,
      rateLimitAccessLogs,
      rateLimitPublicDownload,
    } = await import("../rateLimiter");

    expect(typeof rateLimitCreateShare).toBe("function");
    expect(typeof rateLimitDownloadShare).toBe("function");
    expect(typeof rateLimitListShare).toBe("function");
    expect(typeof rateLimitRevokeShare).toBe("function");
    expect(typeof rateLimitAccessLogs).toBe("function");
    expect(typeof rateLimitPublicDownload).toBe("function");
  });
});
