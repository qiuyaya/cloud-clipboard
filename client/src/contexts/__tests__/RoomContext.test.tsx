/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";

// Mock the shared types
vi.mock("@cloud-clipboard/shared", () => ({}));

const { RoomProvider, useRoom } = await import("../RoomContext");

describe("RoomContext", () => {
  it("useRoom throws when used outside RoomProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useRoom());
    }).toThrow("useRoom must be used within RoomProvider");
    spy.mockRestore();
  });

  it("useRoom returns context value when inside RoomProvider", () => {
    const mockValue = {
      roomKey: "test123",
      currentUser: { id: "u1", name: "Alice" },
      users: [],
      messages: [],
      hasRoomPassword: false,
      isPinned: false,
      onSendMessage: vi.fn(),
      onSendFile: vi.fn(),
      onLeaveRoom: vi.fn(),
      onSetRoomPassword: vi.fn(),
      onShareRoomLink: vi.fn(),
      onNavigateToShare: vi.fn(),
      onRecallMessage: vi.fn(),
      onPinRoom: vi.fn(),
    };

    const { result } = renderHook(() => useRoom(), {
      wrapper: ({ children }) => React.createElement(RoomProvider, { value: mockValue }, children),
    });

    expect(result.current).toBe(mockValue);
    expect(result.current.roomKey).toBe("test123");
  });
});
