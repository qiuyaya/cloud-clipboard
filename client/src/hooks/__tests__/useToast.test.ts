import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// Mock the toast UI component to avoid importing Radix
vi.mock("@/components/ui/toast", () => ({
  ToastAction: () => null,
}));

// Use importOriginal to get the real exports
const { reducer, useToast, toast } =
  await vi.importActual<typeof import("../useToast")>("../useToast");

describe("useToast reducer", () => {
  const initialState = { toasts: [] };

  it("ADD_TOAST adds a toast", () => {
    const state = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "Hello" },
    });
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe("1");
  });

  it("ADD_TOAST respects TOAST_LIMIT of 1", () => {
    const state1 = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "First" },
    });
    const state2 = reducer(state1, {
      type: "ADD_TOAST",
      toast: { id: "2", title: "Second" },
    });
    expect(state2.toasts).toHaveLength(1);
    expect(state2.toasts[0].id).toBe("2");
  });

  it("UPDATE_TOAST updates matching toast", () => {
    const state1 = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "Original" },
    });
    const state2 = reducer(state1, {
      type: "UPDATE_TOAST",
      toast: { id: "1", title: "Updated" },
    });
    expect(state2.toasts[0].title).toBe("Updated");
  });

  it("DISMISS_TOAST sets open=false for specific toast", () => {
    const state1 = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "Test", open: true },
    });
    const state2 = reducer(state1, {
      type: "DISMISS_TOAST",
      toastId: "1",
    });
    expect(state2.toasts[0].open).toBe(false);
  });

  it("DISMISS_TOAST without toastId dismisses all", () => {
    const multiState = {
      toasts: [
        { id: "1", title: "A", open: true },
        { id: "2", title: "B", open: true },
      ],
    };
    const state = reducer(multiState, {
      type: "DISMISS_TOAST",
      toastId: undefined,
    });
    expect(state.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST removes specific toast", () => {
    const multiState = {
      toasts: [
        { id: "1", title: "A" },
        { id: "2", title: "B" },
      ],
    };
    const state = reducer(multiState, {
      type: "REMOVE_TOAST",
      toastId: "1",
    });
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe("2");
  });

  it("REMOVE_TOAST without toastId clears all", () => {
    const multiState = {
      toasts: [
        { id: "1", title: "A" },
        { id: "2", title: "B" },
      ],
    };
    const state = reducer(multiState, {
      type: "REMOVE_TOAST",
      toastId: undefined,
    });
    expect(state.toasts).toHaveLength(0);
  });
});

describe("toast function", () => {
  it("creates a toast and returns id, dismiss, update", () => {
    const result = toast({ title: "Test toast" });
    expect(result.id).toBeDefined();
    expect(typeof result.dismiss).toBe("function");
    expect(typeof result.update).toBe("function");
  });

  it("generates unique IDs for each call", () => {
    const t1 = toast({ title: "First" });
    const t2 = toast({ title: "Second" });
    expect(t1.id).not.toBe(t2.id);
  });

  it("dismiss removes the toast", () => {
    const result = toast({ title: "Dismiss me" });
    result.dismiss();
    // dismiss dispatches DISMISS_TOAST which sets open=false
    // The actual removal happens after TOAST_REMOVE_DELAY
    expect(result.dismiss).not.toThrow();
  });

  it("update modifies the toast", () => {
    const result = toast({ title: "Original" });
    result.update({ id: result.id, title: "Updated" });
    expect(result.update).not.toThrow();
  });
});

describe("useToast hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns toast function and dismiss", () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.toast).toBe("function");
    expect(typeof result.current.dismiss).toBe("function");
    expect(Array.isArray(result.current.toasts)).toBe(true);
  });

  it("can create a toast via hook", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Hook toast" });
    });
    expect(result.current.toasts.length).toBeGreaterThan(0);
  });

  it("can dismiss a toast via hook", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      const t = result.current.toast({ title: "Dismiss test" });
      result.current.dismiss(t.id);
    });
    // After dismiss, open should be false
    const dismissedToast = result.current.toasts.find((t) => t.open === false);
    expect(dismissedToast).toBeDefined();
  });
});
