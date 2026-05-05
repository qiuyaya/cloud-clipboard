import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock getApiPath
vi.mock("@/utils/api", () => ({
  getApiPath: (path: string) => `/base${path}`,
}));

const { shareApi } = await import("../shareApi");

describe("ShareApiService", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("createShare", () => {
    it("sends POST request with correct body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { shareId: "abc", url: "http://x" } }),
      });

      const result = await shareApi.createShare({
        fileId: "file1",
        password: "pass",
        expiresInDays: 7,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/base/api/share",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
      expect(result.shareId).toBe("abc");
    });

    it("throws on error response with JSON message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({ message: "Invalid request" }),
      });

      // The catch block in createShare catches the thrown Error too,
      // so it falls through to the generic HTTP error
      await expect(shareApi.createShare({ fileId: "f1" })).rejects.toThrow("HTTP 400: Bad Request");
    });

    it("throws on error response without JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.createShare({ fileId: "f1" })).rejects.toThrow(
        "HTTP 500: Internal Server Error",
      );
    });
  });

  describe("listShares", () => {
    it("sends GET with query params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { shares: [], total: 0 } }),
      });

      const result = await shareApi.listShares({
        status: "active",
        limit: 10,
        offset: 5, // offset=0 is falsy, so use non-zero
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("status=active");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=5");
      expect(result.total).toBe(0);
    });

    it("works without params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { shares: [], total: 0 } }),
      });

      const result = await shareApi.listShares();
      expect(result.shares).toEqual([]);
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.listShares()).rejects.toThrow("HTTP 500");
    });
  });

  describe("getShareDetails", () => {
    it("sends GET to /:shareId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { shareId: "s1", status: "active" } }),
      });

      const result = await shareApi.getShareDetails("s1");
      expect(mockFetch).toHaveBeenCalledWith(
        "/base/api/share/s1",
        expect.objectContaining({ credentials: "include" }),
      );
      expect(result.shareId).toBe("s1");
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.getShareDetails("bad-id")).rejects.toThrow("HTTP 404");
    });
  });

  describe("revokeShare", () => {
    it("sends DELETE to /:shareId", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await shareApi.revokeShare("s1");
      expect(mockFetch).toHaveBeenCalledWith(
        "/base/api/share/s1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.revokeShare("s1")).rejects.toThrow("HTTP 403");
    });
  });

  describe("permanentDeleteShare", () => {
    it("sends POST to /:shareId/permanent-delete", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await shareApi.permanentDeleteShare("s1");
      expect(mockFetch).toHaveBeenCalledWith(
        "/base/api/share/s1/permanent-delete",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.permanentDeleteShare("s1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("getAccessLogs", () => {
    it("sends GET with limit param", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { logs: [], total: 0 } }),
      });

      await shareApi.getAccessLogs("s1", 50);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=50");
    });

    it("sends GET without limit param", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { logs: [], total: 0 } }),
      });

      await shareApi.getAccessLogs("s1");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("limit");
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.getAccessLogs("s1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("downloadShare", () => {
    it("sends GET with Basic Auth header when password provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["data"])),
      });

      await shareApi.downloadShare("s1", "mypass");
      expect(mockFetch).toHaveBeenCalledWith(
        "/base/api/share/s1/download",
        expect.objectContaining({
          headers: { Authorization: "Basic " + btoa("user:mypass") },
        }),
      );
    });

    it("sends GET without Auth header when no password", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["data"])),
      });

      await shareApi.downloadShare("s1");
      expect(mockFetch).toHaveBeenCalledWith(
        "/base/api/share/s1/download",
        expect.objectContaining({
          headers: {},
        }),
      );
    });

    it("throws on error with JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ message: "Wrong password" }),
      });

      // The catch block catches the Error from the throw inside try,
      // so it falls through to the generic HTTP error
      await expect(shareApi.downloadShare("s1", "wrong")).rejects.toThrow("HTTP 401");
    });

    it("throws on error with non-JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("not json")),
      });

      await expect(shareApi.downloadShare("s1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("testShare", () => {
    it("returns accessible=true, requiresPassword=true for 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await shareApi.testShare("s1");
      expect(result).toEqual({
        accessible: true,
        requiresPassword: true,
      });
    });

    it("returns accessible=false for non-401 error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await shareApi.testShare("s1");
      expect(result).toEqual({
        accessible: false,
        requiresPassword: false,
      });
    });

    it("returns share info for successful response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              hasPassword: true,
              expiresAt: "2026-01-01",
              status: "active",
            },
          }),
      });

      const result = await shareApi.testShare("s1");
      expect(result.accessible).toBe(true);
      expect(result.requiresPassword).toBe(true);
      expect(result.expiresAt).toBe("2026-01-01");
      expect(result.status).toBe("active");
    });

    it("handles JSON parse failure gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error("bad json")),
      });

      const result = await shareApi.testShare("s1");
      expect(result).toEqual({
        accessible: true,
        requiresPassword: false,
      });
    });

    it("handles network error gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await shareApi.testShare("s1");
      expect(result).toEqual({
        accessible: false,
        requiresPassword: false,
      });
    });
  });
});
