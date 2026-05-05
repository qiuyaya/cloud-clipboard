import { renderHook, act } from "@testing-library/react";
import { useTemporaryState } from "../useTemporaryState";

describe("useTemporaryState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial value", () => {
    const { result } = renderHook(() => useTemporaryState<string>(null));
    expect(result.current[0]).toBe(null);
  });

  it("sets value and reverts after timeout", () => {
    const { result } = renderHook(() => useTemporaryState<string>(null, 1000));
    act(() => {
      result.current[1]("hello");
    });
    expect(result.current[0]).toBe("hello");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe(null);
  });

  it("clears previous timeout on consecutive calls", () => {
    const { result } = renderHook(() => useTemporaryState<string>(null, 1000));
    act(() => {
      result.current[1]("first");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      result.current[1]("second");
    });
    expect(result.current[0]).toBe("second");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current[0]).toBe("second");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current[0]).toBe(null);
  });

  it("uses custom duration", () => {
    const { result } = renderHook(() => useTemporaryState<number>(0, 200));
    act(() => {
      result.current[1](42);
    });
    expect(result.current[0]).toBe(42);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current[0]).toBe(42);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe(0);
  });

  it("clears timeout on unmount", () => {
    const { result, unmount } = renderHook(() => useTemporaryState<string>(null, 1000));
    act(() => {
      result.current[1]("test");
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe("test");
  });
});
