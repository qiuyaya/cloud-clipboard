import { describe, it, expect, vi, beforeEach } from "vitest";

// Track emit calls
const emitCalls: Array<{ event: string; args: any[] }> = [];
const mockSocket = {
  connected: true,
  id: "socket-123",
  io: { engine: { transport: { name: "websocket" } } },
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn((event: string, ...args: any[]) => {
    emitCalls.push({ event, args });
  }),
  disconnect: vi.fn(),
  onAny: vi.fn(),
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

vi.mock("@/utils/debug", () => ({
  debug: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.stubGlobal("window", {
  location: { origin: "http://localhost:3000" },
});

vi.stubGlobal("import.meta", {
  env: {
    BASE_URL: "/",
    PROD: true,
    DEV: false,
  },
});

const { socketService } = await import("../socket");

describe("SocketService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitCalls.length = 0;
    socketService.disconnect();
  });

  describe("connect", () => {
    it("creates a new socket connection", () => {
      const socket = socketService.connect();
      expect(socket).toBeDefined();
    });

    it("returns existing socket when already connected", () => {
      socketService.connect();
      const socket2 = socketService.connect();
      expect(socket2).toBeDefined();
    });
  });

  describe("disconnect", () => {
    it("disconnects and clears socket", () => {
      socketService.connect();
      socketService.disconnect();
      expect(socketService.getSocket()).toBeNull();
    });
  });

  describe("joinRoom", () => {
    it("emits joinRoom event when socket is connected", () => {
      socketService.connect();
      mockSocket.connected = true;
      socketService.joinRoom({ roomKey: "test1a", user: { name: "Alice" } });
      expect(emitCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "joinRoom",
            args: [{ roomKey: "test1a", user: { name: "Alice" } }],
          }),
        ]),
      );
    });

    it("does not emit when socket is not connected", () => {
      socketService.connect();
      mockSocket.connected = false;
      emitCalls.length = 0;
      socketService.joinRoom({ roomKey: "test1a", user: { name: "Alice" } });
      expect(emitCalls).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "joinRoom" })]),
      );
    });
  });

  describe("joinRoomWithPassword", () => {
    it("emits joinRoomWithPassword event when connected", () => {
      socketService.connect();
      mockSocket.connected = true;
      socketService.joinRoomWithPassword({
        roomKey: "test1a",
        user: { name: "Bob" },
        password: "secret",
      });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "joinRoomWithPassword" })]),
      );
    });
  });

  describe("setRoomPassword", () => {
    it("emits setRoomPassword event", () => {
      socketService.connect();
      socketService.setRoomPassword({
        roomKey: "test1a",
        userId: "u1",
        password: "newpass",
      });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "setRoomPassword" })]),
      );
    });
  });

  describe("shareRoomLink", () => {
    it("emits shareRoomLink event", () => {
      socketService.connect();
      socketService.shareRoomLink({ roomKey: "test1a", userId: "u1" });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "shareRoomLink" })]),
      );
    });
  });

  describe("pinRoom", () => {
    it("emits pinRoom event", () => {
      socketService.connect();
      socketService.pinRoom({ roomKey: "test1a", userId: "u1", isPinned: true });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "pinRoom" })]),
      );
    });
  });

  describe("recallMessage", () => {
    it("emits recallMessage event", () => {
      socketService.connect();
      socketService.recallMessage({ messageId: "msg1", roomKey: "test1a" });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "recallMessage" })]),
      );
    });
  });

  describe("leaveRoom", () => {
    it("emits leaveRoom event", () => {
      socketService.connect();
      socketService.leaveRoom({ roomKey: "test1a", userId: "u1" });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "leaveRoom" })]),
      );
    });
  });

  describe("sendMessage", () => {
    it("emits sendMessage event", () => {
      socketService.connect();
      const message = {
        type: "text" as const,
        id: "msg1",
        content: "hello",
        sender: { id: "u1", name: "Alice" },
        timestamp: new Date().toISOString(),
        roomKey: "test1a",
      };
      socketService.sendMessage(message);
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "sendMessage" })]),
      );
    });
  });

  describe("requestUserList", () => {
    it("emits requestUserList event", () => {
      socketService.connect();
      socketService.requestUserList("test1a");
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "requestUserList" })]),
      );
    });
  });

  describe("P2P signaling", () => {
    it("emits p2pOffer event", () => {
      socketService.connect();
      socketService.sendP2POffer({ to: "u2", offer: "sdp-offer" });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "p2pOffer" })]),
      );
    });

    it("emits p2pAnswer event", () => {
      socketService.connect();
      socketService.sendP2PAnswer({ to: "u1", answer: "sdp-answer" });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "p2pAnswer" })]),
      );
    });

    it("emits p2pIceCandidate event", () => {
      socketService.connect();
      socketService.sendP2PIceCandidate({ to: "u1", candidate: "ice-candidate" });
      expect(emitCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "p2pIceCandidate" })]),
      );
    });
  });

  describe("event listeners", () => {
    it("registers onMessage listener", () => {
      socketService.connect();
      socketService.onMessage(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("registers onMessageHistory listener", () => {
      socketService.connect();
      socketService.onMessageHistory(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("messageHistory", expect.any(Function));
    });

    it("registers onUserJoined listener", () => {
      socketService.connect();
      socketService.onUserJoined(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("userJoined", expect.any(Function));
    });

    it("registers onUserLeft listener", () => {
      socketService.connect();
      socketService.onUserLeft(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("userLeft", expect.any(Function));
    });

    it("registers onUserList listener", () => {
      socketService.connect();
      socketService.onUserList(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("userList", expect.any(Function));
    });

    it("registers onSystemMessage listener", () => {
      socketService.connect();
      socketService.onSystemMessage(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("systemMessage", expect.any(Function));
    });

    it("registers onRoomDestroyed listener", () => {
      socketService.connect();
      socketService.onRoomDestroyed(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("roomDestroyed", expect.any(Function));
    });

    it("registers onError listener", () => {
      socketService.connect();
      socketService.onError(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("registers onPasswordRequired listener", () => {
      socketService.connect();
      socketService.onPasswordRequired(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("passwordRequired", expect.any(Function));
    });

    it("registers onRoomPasswordSet listener", () => {
      socketService.connect();
      socketService.onRoomPasswordSet(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("roomPasswordSet", expect.any(Function));
    });

    it("registers onRoomLinkGenerated listener", () => {
      socketService.connect();
      socketService.onRoomLinkGenerated(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("roomLinkGenerated", expect.any(Function));
    });

    it("registers onMessageRecalled listener", () => {
      socketService.connect();
      socketService.onMessageRecalled(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("messageRecalled", expect.any(Function));
    });

    it("registers onRoomPinned listener", () => {
      socketService.connect();
      socketService.onRoomPinned(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("roomPinned", expect.any(Function));
    });

    it("registers P2P listeners", () => {
      socketService.connect();
      socketService.onP2POffer(vi.fn());
      socketService.onP2PAnswer(vi.fn());
      socketService.onP2PIceCandidate(vi.fn());
      expect(mockSocket.on).toHaveBeenCalledWith("p2pOffer", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("p2pAnswer", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("p2pIceCandidate", expect.any(Function));
    });
  });

  describe("on/off generic", () => {
    it("registers generic event listener", () => {
      socketService.connect();
      const callback = vi.fn();
      socketService.on("customEvent", callback);
      expect(mockSocket.on).toHaveBeenCalledWith("customEvent", callback);
    });

    it("removes generic event listener", () => {
      socketService.connect();
      const callback = vi.fn();
      socketService.off("customEvent", callback);
      expect(mockSocket.off).toHaveBeenCalledWith("customEvent", callback);
    });
  });

  describe("isSocketConnected", () => {
    it("returns false when not connected", () => {
      expect(socketService.isSocketConnected()).toBe(false);
    });
  });

  describe("getSocket", () => {
    it("returns null when not connected", () => {
      expect(socketService.getSocket()).toBeNull();
    });

    it("returns socket after connect", () => {
      socketService.connect();
      expect(socketService.getSocket()).toBeDefined();
    });
  });
});
