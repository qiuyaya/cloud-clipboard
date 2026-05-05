/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
vi.stubGlobal("localStorage", localStorageMock);

// Mock matchMedia
vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

const { ThemeProvider, useThemeContext } = await import("../ThemeProvider");

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  it("provides default system theme", () => {
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ({ children }) => React.createElement(ThemeProvider, null, children),
    });
    expect(result.current.theme).toBe("system");
  });

  it("reads theme from localStorage", () => {
    localStorageMock.setItem("vite-ui-theme", "dark");
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ({ children }) => React.createElement(ThemeProvider, null, children),
    });
    expect(result.current.theme).toBe("dark");
  });

  it("setTheme updates theme and saves to localStorage", () => {
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ({ children }) => React.createElement(ThemeProvider, null, children),
    });

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(localStorageMock.getItem("vite-ui-theme")).toBe("dark");
  });

  it("applies theme class to document element for explicit theme", () => {
    localStorageMock.setItem("vite-ui-theme", "light");
    renderHook(() => useThemeContext(), {
      wrapper: ({ children }) => React.createElement(ThemeProvider, null, children),
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("uses custom storage key", () => {
    localStorageMock.setItem("custom-key", "light");
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ({ children }) =>
        React.createElement(ThemeProvider, { storageKey: "custom-key" }, children),
    });
    expect(result.current.theme).toBe("light");
  });

  it("uses defaultTheme prop when localStorage is empty", () => {
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ({ children }) =>
        React.createElement(ThemeProvider, { defaultTheme: "dark" }, children),
    });
    expect(result.current.theme).toBe("dark");
  });
});
