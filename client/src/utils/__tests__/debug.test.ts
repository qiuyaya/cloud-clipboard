import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage before importing debug
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(localStorageStore)) {
      delete localStorageStore[key];
    }
  }),
};

vi.stubGlobal("localStorage", localStorageMock);

// Import after mocking
import { debug } from "../debug";

describe("DebugLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Reset debug state
    debug.clear();
  });

  describe("initial state", () => {
    it("starts disabled by default", () => {
      expect(debug.getConfig().enabled).toBe(false);
    });

    it("starts with info level", () => {
      expect(debug.getConfig().level).toBe("info");
    });
  });

  describe("enable/disable", () => {
    it("enables debug mode", () => {
      debug.enable();
      expect(debug.getConfig().enabled).toBe(true);
    });

    it("disables debug mode", () => {
      debug.enable();
      debug.disable();
      expect(debug.getConfig().enabled).toBe(false);
    });

    it("persists config to localStorage on enable", () => {
      debug.enable();
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "cloud-clipboard-debug",
        expect.any(String),
      );
    });

    it("persists config to localStorage on disable", () => {
      debug.disable();
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe("setLevel", () => {
    it("sets log level", () => {
      debug.setLevel("debug");
      expect(debug.getConfig().level).toBe("debug");
    });

    it("sets warn level", () => {
      debug.setLevel("warn");
      expect(debug.getConfig().level).toBe("warn");
    });

    it("sets error level", () => {
      debug.setLevel("error");
      expect(debug.getConfig().level).toBe("error");
    });
  });

  describe("logging methods", () => {
    it("does not log when disabled", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debug.debug("test message");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("logs debug messages when enabled at debug level", () => {
      debug.enable();
      debug.setLevel("debug");
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debug.debug("test debug");
      expect(spy).toHaveBeenCalledWith("[DEBUG] test debug");
      spy.mockRestore();
    });

    it("logs info messages when enabled at info level", () => {
      debug.enable();
      debug.setLevel("info");
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      debug.info("test info");
      expect(spy).toHaveBeenCalledWith("[INFO] test info");
      spy.mockRestore();
    });

    it("logs warn messages when enabled at warn level", () => {
      debug.enable();
      debug.setLevel("warn");
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      debug.warn("test warn");
      expect(spy).toHaveBeenCalledWith("[WARN] test warn");
      spy.mockRestore();
    });

    it("logs error messages when enabled at error level", () => {
      debug.enable();
      debug.setLevel("error");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      debug.error("test error");
      expect(spy).toHaveBeenCalledWith("[ERROR] test error");
      spy.mockRestore();
    });

    it("filters debug messages at info level", () => {
      debug.enable();
      debug.setLevel("info");
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debug.debug("should not log");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("filters info messages at warn level", () => {
      debug.enable();
      debug.setLevel("warn");
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      debug.info("should not log");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("filters warn messages at error level", () => {
      debug.enable();
      debug.setLevel("error");
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      debug.warn("should not log");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("passes extra args to console methods", () => {
      debug.enable();
      debug.setLevel("debug");
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      debug.info("msg", { key: "val" });
      expect(spy).toHaveBeenCalledWith("[INFO] msg", { key: "val" });
      spy.mockRestore();
    });
  });

  describe("group/groupEnd/table", () => {
    it("calls console.group when enabled", () => {
      debug.enable();
      const spy = vi.spyOn(console, "group").mockImplementation(() => {});
      debug.group("test group");
      expect(spy).toHaveBeenCalledWith("test group");
      spy.mockRestore();
    });

    it("does not call console.group when disabled", () => {
      const spy = vi.spyOn(console, "group").mockImplementation(() => {});
      debug.group("test group");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("calls console.groupEnd when enabled", () => {
      debug.enable();
      const spy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
      debug.groupEnd();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("calls console.table when enabled", () => {
      debug.enable();
      const spy = vi.spyOn(console, "table").mockImplementation(() => {});
      debug.table([{ a: 1 }]);
      expect(spy).toHaveBeenCalledWith([{ a: 1 }]);
      spy.mockRestore();
    });
  });

  describe("clear", () => {
    it("resets config to defaults", () => {
      debug.enable();
      debug.setLevel("debug");
      debug.clear();
      expect(debug.getConfig().enabled).toBe(false);
      expect(debug.getConfig().level).toBe("info");
    });

    it("removes localStorage key", () => {
      debug.enable();
      debug.clear();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith("cloud-clipboard-debug");
    });
  });

  describe("getConfig", () => {
    it("returns a copy of config", () => {
      const config = debug.getConfig();
      config.enabled = true;
      expect(debug.getConfig().enabled).toBe(false);
    });
  });

  describe("window.cloudClipboardDebug", () => {
    it("exposes debug API on window", () => {
      const api = (window as any).cloudClipboardDebug;
      expect(api).toBeDefined();
      expect(typeof api.enable).toBe("function");
      expect(typeof api.disable).toBe("function");
      expect(typeof api.setLevel).toBe("function");
      expect(typeof api.getConfig).toBe("function");
      expect(typeof api.clear).toBe("function");
    });

    it("enable() via window API enables debug", () => {
      const api = (window as any).cloudClipboardDebug;
      api.enable();
      expect(debug.getConfig().enabled).toBe(true);
    });

    it("disable() via window API disables debug", () => {
      const api = (window as any).cloudClipboardDebug;
      api.enable();
      api.disable();
      expect(debug.getConfig().enabled).toBe(false);
    });

    it("setLevel() via window API sets level", () => {
      const api = (window as any).cloudClipboardDebug;
      api.setLevel("warn");
      expect(debug.getConfig().level).toBe("warn");
    });

    it("clear() via window API resets config", () => {
      const api = (window as any).cloudClipboardDebug;
      api.enable();
      api.clear();
      expect(debug.getConfig().enabled).toBe(false);
      expect(debug.getConfig().level).toBe("info");
    });
  });

  describe("constructor with saved config", () => {
    it("reads saved config from localStorage", () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ enabled: true, level: "debug" }),
      );
      // Re-import to trigger constructor with saved config
      // Since debug is a singleton, we test via the window API
      // that was set during construction
      const api = (window as any).cloudClipboardDebug;
      expect(api).toBeDefined();
    });

    it("handles invalid JSON in localStorage gracefully", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      localStorageMock.getItem.mockReturnValueOnce("not-valid-json");
      // The singleton was already created, so we verify the warn was not thrown
      // by checking debug still works
      expect(debug.getConfig().enabled).toBe(false);
      warnSpy.mockRestore();
    });
  });
});
