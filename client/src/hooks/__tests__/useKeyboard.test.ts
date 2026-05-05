import { renderHook, act } from "@testing-library/react";
import { useKeyboard } from "../useKeyboard";

describe("useKeyboard", () => {
  const originalVisualViewport = window.visualViewport;
  const originalRAF = window.requestAnimationFrame;
  const originalCAF = window.cancelAnimationFrame;

  function mockRAF() {
    let id = 0;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const currentId = ++id;
      // Execute synchronously so act() can capture state updates
      cb(0);
      return currentId;
    };
    window.cancelAnimationFrame = () => {};
  }

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      value: originalVisualViewport,
      writable: true,
    });
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCAF;
  });

  it("returns default state when visualViewport is unavailable", () => {
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      writable: true,
    });
    const { result } = renderHook(() => useKeyboard());
    expect(result.current.isKeyboardOpen).toBe(false);
    expect(result.current.keyboardHeight).toBe(0);
  });

  it("detects keyboard open when viewport shrinks", () => {
    mockRAF();
    const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
    let vvHeight = 860;

    Object.defineProperty(window, "visualViewport", {
      value: {
        get height() {
          return vvHeight;
        },
        get offsetTop() {
          return 0;
        },
        get width() {
          return 375;
        },
        addEventListener(type: string, listener: () => void) {
          listeners[type]?.push(listener);
        },
        removeEventListener: vi.fn(),
      },
      writable: true,
    });

    Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

    const { result } = renderHook(() => useKeyboard());
    expect(result.current.isKeyboardOpen).toBe(false);

    act(() => {
      vvHeight = 400;
      listeners.resize.forEach((l) => l());
    });

    expect(result.current.isKeyboardOpen).toBe(true);
    expect(result.current.keyboardHeight).toBe(500);
  });

  it("detects keyboard close", () => {
    mockRAF();
    const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
    let vvHeight = 400;

    Object.defineProperty(window, "visualViewport", {
      value: {
        get height() {
          return vvHeight;
        },
        get offsetTop() {
          return 0;
        },
        get width() {
          return 375;
        },
        addEventListener(type: string, listener: () => void) {
          listeners[type]?.push(listener);
        },
        removeEventListener: vi.fn(),
      },
      writable: true,
    });

    Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

    const { result } = renderHook(() => useKeyboard());
    expect(result.current.isKeyboardOpen).toBe(true);

    act(() => {
      vvHeight = 850;
      listeners.resize.forEach((l) => l());
    });

    expect(result.current.isKeyboardOpen).toBe(false);
    expect(result.current.keyboardHeight).toBe(0);
  });

  it("does not update state when values unchanged", () => {
    mockRAF();
    const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };

    Object.defineProperty(window, "visualViewport", {
      value: {
        height: 800,
        offsetTop: 0,
        width: 375,
        addEventListener(type: string, listener: () => void) {
          listeners[type]?.push(listener);
        },
        removeEventListener: vi.fn(),
      },
      writable: true,
    });

    Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

    const { result } = renderHook(() => useKeyboard());
    const stateBefore = result.current;

    act(() => {
      listeners.scroll.forEach((l) => l());
    });

    // State should be the same object reference since nothing changed
    expect(result.current).toBe(stateBefore);
  });

  it("cleans up listeners on unmount", () => {
    const removeEventListener = vi.fn();
    const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };

    Object.defineProperty(window, "visualViewport", {
      value: {
        height: 800,
        offsetTop: 0,
        width: 375,
        addEventListener(type: string, listener: () => void) {
          listeners[type]?.push(listener);
        },
        removeEventListener,
      },
      writable: true,
    });

    const { unmount } = renderHook(() => useKeyboard());
    unmount();
    expect(removeEventListener).toHaveBeenCalled();
  });
});
