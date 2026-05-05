import { renderHook } from "@testing-library/react";
import { useActivityMonitor } from "../useActivityMonitor";

describe("useActivityMonitor", () => {
  const mockOnLeaveRoom = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnLeaveRoom.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers activity event listeners", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    renderHook(() =>
      useActivityMonitor({
        currentUser: { id: "1", name: "test" } as any,
        onLeaveRoom: mockOnLeaveRoom,
      }),
    );

    expect(addSpy).toHaveBeenCalledWith("mousedown", expect.any(Function), { passive: true });
    expect(addSpy).toHaveBeenCalledWith("mousemove", expect.any(Function), { passive: true });
    expect(addSpy).toHaveBeenCalledWith("keypress", expect.any(Function), { passive: true });
    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), { passive: true });
    expect(addSpy).toHaveBeenCalledWith("touchstart", expect.any(Function), { passive: true });

    addSpy.mockRestore();
  });

  it("removes event listeners on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() =>
      useActivityMonitor({
        currentUser: { id: "1", name: "test" } as any,
        onLeaveRoom: mockOnLeaveRoom,
      }),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keypress", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("touchstart", expect.any(Function));

    removeSpy.mockRestore();
  });

  it("does not call onLeaveRoom when user is null", () => {
    renderHook(() => useActivityMonitor({ currentUser: null, onLeaveRoom: mockOnLeaveRoom }));

    act(() => {
      vi.advanceTimersByTime(120000);
    });

    expect(mockOnLeaveRoom).not.toHaveBeenCalled();
  });
});

function act(fn: () => void) {
  fn();
}
