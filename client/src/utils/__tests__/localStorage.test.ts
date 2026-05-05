import { saveToLocalStorage, loadFromLocalStorage } from "../localStorage";

describe("localStorage utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("saveToLocalStorage", () => {
    it("saves JSON-serializable data", () => {
      saveToLocalStorage("test-key", { name: "hello" });
      expect(localStorage.getItem("test-key")).toBe('{"name":"hello"}');
    });

    it("saves string data", () => {
      saveToLocalStorage("test-key", "hello");
      expect(localStorage.getItem("test-key")).toBe('"hello"');
    });

    it("saves number data", () => {
      saveToLocalStorage("test-key", 42);
      expect(localStorage.getItem("test-key")).toBe("42");
    });

    it("handles storage errors gracefully", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
      expect(() => saveToLocalStorage("test-key", "data")).not.toThrow();
      spy.mockRestore();
    });
  });

  describe("loadFromLocalStorage", () => {
    it("loads and parses JSON data", () => {
      localStorage.setItem("test-key", '{"name":"hello"}');
      expect(loadFromLocalStorage("test-key")).toEqual({ name: "hello" });
    });

    it("returns null for missing key", () => {
      expect(loadFromLocalStorage("nonexistent")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      localStorage.setItem("test-key", "not-json");
      expect(loadFromLocalStorage("test-key")).toBeNull();
    });

    it("handles storage errors gracefully", () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });
      expect(loadFromLocalStorage("test-key")).toBeNull();
      spy.mockRestore();
    });
  });
});
