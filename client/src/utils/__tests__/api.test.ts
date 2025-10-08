import { describe, it, expect, afterEach } from "vitest";
import { getApiPath } from "../api";

describe("getApiPath", () => {
  const originalEnv = import.meta.env.BASE_URL;

  afterEach(() => {
    // Restore original BASE_URL
    (import.meta.env as any).BASE_URL = originalEnv;
  });

  it("should return path as-is when BASE_URL is /", () => {
    (import.meta.env as any).BASE_URL = "/";
    expect(getApiPath("/api/files/upload")).toBe("/api/files/upload");
    expect(getApiPath("/api/rooms/messages")).toBe("/api/rooms/messages");
  });

  it("should prepend BASE_URL when it's a subpath", () => {
    (import.meta.env as any).BASE_URL = "/clipboard/";
    expect(getApiPath("/api/files/upload")).toBe("/clipboard/api/files/upload");
    expect(getApiPath("/api/rooms/messages")).toBe("/clipboard/api/rooms/messages");
  });

  it("should handle BASE_URL without trailing slash", () => {
    (import.meta.env as any).BASE_URL = "/clipboard";
    expect(getApiPath("/api/files/upload")).toBe("/clipboard/api/files/upload");
  });

  it("should handle path without leading slash", () => {
    (import.meta.env as any).BASE_URL = "/clipboard/";
    expect(getApiPath("api/files/upload")).toBe("/clipboard/api/files/upload");
  });

  it("should handle query parameters", () => {
    (import.meta.env as any).BASE_URL = "/clipboard/";
    expect(getApiPath("/api/rooms/messages?limit=50")).toBe(
      "/clipboard/api/rooms/messages?limit=50"
    );
  });

  it("should default to / when BASE_URL is undefined", () => {
    (import.meta.env as any).BASE_URL = undefined;
    expect(getApiPath("/api/files/upload")).toBe("/api/files/upload");
  });
});
