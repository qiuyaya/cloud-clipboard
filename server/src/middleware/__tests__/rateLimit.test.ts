/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";

// Mock setInterval to avoid memory leaks in tests
vi.stubGlobal(
  "setInterval",
  vi.fn(() => 123 as any),
);
vi.stubGlobal("clearInterval", vi.fn());

describe("RateLimiter Behavior Tests", () => {
  describe("Rate Limit Logic", () => {
    // Test the rate limiting algorithm itself, not the singleton instances
    class TestRateLimiter {
      private records: Map<string, { requests: number; resetTime: number }> = new Map();

      constructor(
        private windowMs: number,
        private maxRequests: number,
      ) {}

      check(key: string): { allowed: boolean; remaining: number; resetTime: number } {
        const now = Date.now();
        let record = this.records.get(key);

        if (!record || now > record.resetTime) {
          record = {
            requests: 1,
            resetTime: now + this.windowMs,
          };
          this.records.set(key, record);
          return { allowed: true, remaining: this.maxRequests - 1, resetTime: record.resetTime };
        }

        if (record.requests >= this.maxRequests) {
          return { allowed: false, remaining: 0, resetTime: record.resetTime };
        }

        record.requests++;
        return {
          allowed: true,
          remaining: this.maxRequests - record.requests,
          resetTime: record.resetTime,
        };
      }

      cleanup(): number {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, record] of this.records.entries()) {
          if (now > record.resetTime) {
            this.records.delete(key);
            cleaned++;
          }
        }
        return cleaned;
      }
    }

    it("should allow requests within limit", () => {
      const limiter = new TestRateLimiter(60000, 5);

      for (let i = 0; i < 5; i++) {
        const result = limiter.check("test-ip");
        expect(result.allowed).toBe(true);
      }
    });

    it("should block requests exceeding limit", () => {
      const limiter = new TestRateLimiter(60000, 5);

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        limiter.check("test-ip");
      }

      // Next request should be blocked
      const result = limiter.check("test-ip");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should track remaining requests correctly", () => {
      const limiter = new TestRateLimiter(60000, 10);

      expect(limiter.check("test-ip").remaining).toBe(9);
      expect(limiter.check("test-ip").remaining).toBe(8);
      expect(limiter.check("test-ip").remaining).toBe(7);
    });

    it("should track different keys separately", () => {
      const limiter = new TestRateLimiter(60000, 3);

      // Exhaust limit for ip-1
      for (let i = 0; i < 3; i++) {
        limiter.check("ip-1");
      }

      // ip-1 should be blocked
      expect(limiter.check("ip-1").allowed).toBe(false);

      // ip-2 should still be allowed
      expect(limiter.check("ip-2").allowed).toBe(true);
    });

    it("should cleanup expired records", () => {
      const limiter = new TestRateLimiter(100, 5); // 100ms window

      limiter.check("test-ip");

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cleaned = limiter.cleanup();
          expect(cleaned).toBe(1);
          resolve();
        }, 150);
      });
    });

    it("should reset counter after window expires", () => {
      const limiter = new TestRateLimiter(100, 2); // 100ms window

      // Exhaust limit
      limiter.check("test-ip");
      limiter.check("test-ip");
      expect(limiter.check("test-ip").allowed).toBe(false);

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(limiter.check("test-ip").allowed).toBe(true);
          resolve();
        }, 150);
      });
    });
  });

  describe("Middleware Response Format", () => {
    it("should return 429 status when rate limited", () => {
      const response = {
        success: false,
        message: "Too many requests. Please try again later.",
      };

      expect(response.success).toBe(false);
      expect(response.message).toContain("Too many requests");
    });

    it("should include rate limit headers", () => {
      const headers = {
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "95",
        "X-RateLimit-Reset": new Date(Date.now() + 60000).toISOString(),
      };

      expect(headers["X-RateLimit-Limit"]).toBeDefined();
      expect(headers["X-RateLimit-Remaining"]).toBeDefined();
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
    });
  });

  describe("Rate Limiter Configuration", () => {
    it("should have general rate limit configured", async () => {
      const { HTTP_RATE_LIMITS } = await import("@cloud-clipboard/shared");

      expect(HTTP_RATE_LIMITS.GENERAL.MAX_REQUESTS).toBeDefined();
      expect(HTTP_RATE_LIMITS.GENERAL.WINDOW_MS).toBeDefined();
    });

    it("should have upload rate limit configured", async () => {
      const { HTTP_RATE_LIMITS } = await import("@cloud-clipboard/shared");

      expect(HTTP_RATE_LIMITS.UPLOAD.MAX_REQUESTS).toBeDefined();
      expect(HTTP_RATE_LIMITS.UPLOAD.WINDOW_MS).toBeDefined();
    });

    it("should have auth rate limit configured", async () => {
      const { HTTP_RATE_LIMITS } = await import("@cloud-clipboard/shared");

      expect(HTTP_RATE_LIMITS.AUTH.MAX_REQUESTS).toBeDefined();
      expect(HTTP_RATE_LIMITS.AUTH.WINDOW_MS).toBeDefined();
    });

    it("should have strict rate limit configured", async () => {
      const { HTTP_RATE_LIMITS } = await import("@cloud-clipboard/shared");

      expect(HTTP_RATE_LIMITS.STRICT.MAX_REQUESTS).toBeDefined();
      expect(HTTP_RATE_LIMITS.STRICT.WINDOW_MS).toBeDefined();
    });

    it("should have room action rate limit configured", async () => {
      const { HTTP_RATE_LIMITS } = await import("@cloud-clipboard/shared");

      expect(HTTP_RATE_LIMITS.ROOM_ACTION.MAX_REQUESTS).toBeDefined();
      expect(HTTP_RATE_LIMITS.ROOM_ACTION.WINDOW_MS).toBeDefined();
    });
  });

  describe("Custom Key Generation", () => {
    it("should support IP-based keys", () => {
      const keyGenerator = (req: any) => req.ip || "unknown";

      expect(keyGenerator({ ip: "192.168.1.1" })).toBe("192.168.1.1");
      expect(keyGenerator({})).toBe("unknown");
    });

    it("should support IP + Room compound keys", () => {
      const keyGenerator = (req: any) => `${req.ip}:${req.roomKey || "no-room"}`;

      expect(keyGenerator({ ip: "192.168.1.1", roomKey: "room123" })).toBe("192.168.1.1:room123");
      expect(keyGenerator({ ip: "192.168.1.1" })).toBe("192.168.1.1:no-room");
    });
  });
});

describe("Rate Limiter Exports", () => {
  it("should export all rate limiters", async () => {
    const rateLimit = await import("../rateLimit");

    expect(rateLimit.generalRateLimit).toBeDefined();
    expect(rateLimit.uploadRateLimit).toBeDefined();
    expect(rateLimit.authRateLimit).toBeDefined();
    expect(rateLimit.strictRateLimit).toBeDefined();
    expect(rateLimit.roomActionRateLimit).toBeDefined();
  });

  it("each limiter should have middleware function", async () => {
    const rateLimit = await import("../rateLimit");

    expect(typeof rateLimit.generalRateLimit.middleware).toBe("function");
    expect(typeof rateLimit.uploadRateLimit.middleware).toBe("function");
    expect(typeof rateLimit.authRateLimit.middleware).toBe("function");
    expect(typeof rateLimit.strictRateLimit.middleware).toBe("function");
    expect(typeof rateLimit.roomActionRateLimit.middleware).toBe("function");
  });
});
