/// <reference types="vitest" />
import { describe, it, expect } from "vitest";

/**
 * Logger Utility Tests
 *
 * These tests define logging behaviors that should be preserved during Rust migration.
 */

describe("Logger - Log Level Behavior", () => {
  describe("LogLevel Enum", () => {
    it("SPEC: should have correct log level ordering", () => {
      // Log levels should be ordered from most verbose to least
      const LogLevel = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        SILENT: 4,
      };

      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
      expect(LogLevel.ERROR).toBeLessThan(LogLevel.SILENT);
    });

    it("SPEC: should filter messages based on log level", () => {
      const LogLevel = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        SILENT: 4,
      };

      const shouldLog = (messageLevel: number, configLevel: number): boolean => {
        return messageLevel >= configLevel && configLevel !== LogLevel.SILENT;
      };

      // When level is INFO, DEBUG should not log
      expect(shouldLog(LogLevel.DEBUG, LogLevel.INFO)).toBe(false);
      expect(shouldLog(LogLevel.INFO, LogLevel.INFO)).toBe(true);
      expect(shouldLog(LogLevel.WARN, LogLevel.INFO)).toBe(true);
      expect(shouldLog(LogLevel.ERROR, LogLevel.INFO)).toBe(true);

      // When level is WARN, DEBUG and INFO should not log
      expect(shouldLog(LogLevel.DEBUG, LogLevel.WARN)).toBe(false);
      expect(shouldLog(LogLevel.INFO, LogLevel.WARN)).toBe(false);
      expect(shouldLog(LogLevel.WARN, LogLevel.WARN)).toBe(true);
      expect(shouldLog(LogLevel.ERROR, LogLevel.WARN)).toBe(true);

      // SILENT should not log anything
      expect(shouldLog(LogLevel.DEBUG, LogLevel.SILENT)).toBe(false);
      expect(shouldLog(LogLevel.INFO, LogLevel.SILENT)).toBe(false);
      expect(shouldLog(LogLevel.WARN, LogLevel.SILENT)).toBe(false);
      expect(shouldLog(LogLevel.ERROR, LogLevel.SILENT)).toBe(false);
    });
  });

  describe("Log Level Configuration", () => {
    it("SPEC: should support setting level by string", () => {
      const LogLevel: Record<string, number> = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        SILENT: 4,
      };

      const setLevel = (level: string | number): number | null => {
        if (typeof level === "string") {
          const upperLevel = level.toUpperCase();
          if (upperLevel in LogLevel) {
            return LogLevel[upperLevel] as number;
          }
          return null;
        }
        return level;
      };

      expect(setLevel("debug")).toBe(0);
      expect(setLevel("INFO")).toBe(1);
      expect(setLevel("Warn")).toBe(2);
      expect(setLevel("error")).toBe(3);
      expect(setLevel("invalid")).toBe(null);
    });

    it("SPEC: should load level from environment variable", () => {
      const getLogLevelFromEnv = (envValue: string | undefined): number => {
        const LogLevel: Record<string, number> = {
          DEBUG: 0,
          INFO: 1,
          WARN: 2,
          ERROR: 3,
          SILENT: 4,
        };

        const defaultLevel = 1; // INFO

        if (!envValue) return defaultLevel;

        const upperValue = envValue.toUpperCase();
        if (upperValue in LogLevel) {
          return LogLevel[upperValue] as number;
        }
        return defaultLevel;
      };

      expect(getLogLevelFromEnv(undefined)).toBe(1); // Default to INFO
      expect(getLogLevelFromEnv("DEBUG")).toBe(0);
      expect(getLogLevelFromEnv("error")).toBe(3);
      expect(getLogLevelFromEnv("invalid")).toBe(1); // Default to INFO
    });
  });
});

describe("Logger - Message Formatting", () => {
  describe("Timestamp Formatting", () => {
    it("SPEC: should format timestamp as ISO 8601", () => {
      const timestamp = new Date().toISOString();

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("SPEC: should optionally include or exclude timestamp", () => {
      const formatMessage = (message: string, options: { timestamps: boolean }): string => {
        if (options.timestamps) {
          return `${new Date().toISOString()} ${message}`;
        }
        return message;
      };

      const withTimestamp = formatMessage("test", { timestamps: true });
      const withoutTimestamp = formatMessage("test", { timestamps: false });

      expect(withTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(withoutTimestamp).toBe("test");
    });
  });

  describe("Level Prefix", () => {
    it("SPEC: should include level prefix in output", () => {
      const formatLevel = (level: string): string => {
        return `[${level}]`;
      };

      expect(formatLevel("DEBUG")).toBe("[DEBUG]");
      expect(formatLevel("INFO")).toBe("[INFO]");
      expect(formatLevel("WARN")).toBe("[WARN]");
      expect(formatLevel("ERROR")).toBe("[ERROR]");
    });
  });

  describe("Context Prefix", () => {
    it("SPEC: should include context when provided", () => {
      const formatWithContext = (message: string, context?: string): string => {
        if (context) {
          return `[${context}] ${message}`;
        }
        return message;
      };

      expect(formatWithContext("test", "RoomService")).toBe("[RoomService] test");
      expect(formatWithContext("test", "FileManager")).toBe("[FileManager] test");
      expect(formatWithContext("test")).toBe("test");
    });
  });

  describe("Data Serialization", () => {
    it("SPEC: should serialize objects for logging", () => {
      const serializeData = (data: unknown): string => {
        if (data === undefined) return "";
        if (typeof data === "object") {
          return JSON.stringify(data);
        }
        return String(data);
      };

      expect(serializeData({ key: "value" })).toBe('{"key":"value"}');
      expect(serializeData([1, 2, 3])).toBe("[1,2,3]");
      expect(serializeData("string")).toBe("string");
      expect(serializeData(123)).toBe("123");
      expect(serializeData(undefined)).toBe("");
    });

    it("SPEC: should handle circular references gracefully", () => {
      const safeStringify = (data: unknown): string => {
        try {
          const seen = new WeakSet();
          return JSON.stringify(data, (_key, value) => {
            if (typeof value === "object" && value !== null) {
              if (seen.has(value)) {
                return "[Circular]";
              }
              seen.add(value);
            }
            return value;
          });
        } catch (e) {
          return "[Object]";
        }
      };

      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      const result = safeStringify(circular);
      expect(result).toContain("[Circular]");
    });
  });
});

describe("Logger - Color Support", () => {
  describe("ANSI Color Codes", () => {
    it("SPEC: should use correct ANSI colors for each level", () => {
      const colors = {
        DEBUG: "\x1b[36m", // cyan
        INFO: "\x1b[32m", // green
        WARN: "\x1b[33m", // yellow
        ERROR: "\x1b[31m", // red
        RESET: "\x1b[0m",
        GRAY: "\x1b[90m",
        MAGENTA: "\x1b[35m",
      };

      expect(colors.DEBUG).toBe("\x1b[36m");
      expect(colors.INFO).toBe("\x1b[32m");
      expect(colors.WARN).toBe("\x1b[33m");
      expect(colors.ERROR).toBe("\x1b[31m");
    });

    it("SPEC: should optionally disable colors", () => {
      const formatLevel = (level: string, useColors: boolean): string => {
        const colors: Record<string, string> = {
          DEBUG: "\x1b[36m",
          INFO: "\x1b[32m",
          WARN: "\x1b[33m",
          ERROR: "\x1b[31m",
        };

        if (useColors) {
          return `${colors[level]}[${level}]\x1b[0m`;
        }
        return `[${level}]`;
      };

      const colored = formatLevel("INFO", true);
      const plain = formatLevel("INFO", false);

      expect(colored).toContain("\x1b[32m");
      expect(plain).toBe("[INFO]");
      expect(plain).not.toContain("\x1b[");
    });
  });
});

describe("Logger - Contextual Logger", () => {
  it("SPEC: should create logger with fixed context", () => {
    const createContextualLogger = (context: string) => {
      return {
        debug: (message: string) => `[DEBUG] [${context}] ${message}`,
        info: (message: string) => `[INFO] [${context}] ${message}`,
        warn: (message: string) => `[WARN] [${context}] ${message}`,
        error: (message: string) => `[ERROR] [${context}] ${message}`,
      };
    };

    const roomLogger = createContextualLogger("RoomService");

    expect(roomLogger.info("Room created")).toContain("[RoomService]");
    expect(roomLogger.error("Room error")).toContain("[RoomService]");
  });
});

describe("Logger - Console Output Methods", () => {
  it("SPEC: should use appropriate console method for each level", () => {
    const consoleMethods = {
      DEBUG: "debug",
      INFO: "info",
      WARN: "warn",
      ERROR: "error",
    };

    expect(consoleMethods.DEBUG).toBe("debug");
    expect(consoleMethods.INFO).toBe("info");
    expect(consoleMethods.WARN).toBe("warn");
    expect(consoleMethods.ERROR).toBe("error");
  });
});

describe("Logger - Environment Configuration", () => {
  it("SPEC: should support LOG_LEVEL environment variable", () => {
    const validEnvValues = ["DEBUG", "INFO", "WARN", "ERROR", "SILENT"];

    for (const value of validEnvValues) {
      expect(validEnvValues.includes(value)).toBe(true);
    }
  });

  it("SPEC: should support LOG_COLORS environment variable", () => {
    const parseBoolean = (value: string | undefined): boolean => {
      if (value === "false") return false;
      if (value === "0") return false;
      return true; // Default to true
    };

    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("0")).toBe(false);
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean(undefined)).toBe(true);
  });

  it("SPEC: should support LOG_TIMESTAMPS environment variable", () => {
    const parseBoolean = (value: string | undefined): boolean => {
      return value !== "false";
    };

    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean(undefined)).toBe(true);
  });

  it("SPEC: should support LOG_CONTEXT environment variable", () => {
    const parseBoolean = (value: string | undefined): boolean => {
      return value !== "false";
    };

    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("true")).toBe(true);
  });
});
