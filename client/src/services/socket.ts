import { io, Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  User,
  TextMessage,
  FileMessage,
  WebSocketMessage,
  JoinRoomRequest,
  JoinRoomWithPasswordRequest,
  LeaveRoomRequest,
  SetRoomPasswordRequest,
  ShareRoomLinkRequest,
} from "@cloud-clipboard/shared";
import { debug } from "../utils/debug";

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private isConnected = false;

  connect(): Socket<ServerToClientEvents, ClientToServerEvents> {
    if (this.socket && this.isConnected) {
      debug.info("Reusing existing socket connection", {
        connected: this.socket.connected,
        id: this.socket.id,
      });
      return this.socket;
    }

    // Use relative path (Vite proxy handles routing in dev, same-origin in prod)
    const serverUrl = window.location.origin;

    // Support subpath deployment for Socket.IO
    const basePath = import.meta.env.BASE_URL || "/";
    // Remove trailing slash from basePath to avoid double slashes
    const normalizedBasePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
    const socketPath =
      normalizedBasePath === "" || normalizedBasePath === "/"
        ? "/socket.io"
        : `${normalizedBasePath}/socket.io`;

    debug.info("Attempting to connect to server", {
      serverUrl,
      isProd: import.meta.env.PROD,
      basePath,
      socketPath,
    });

    this.socket = io(serverUrl, {
      path: socketPath,
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000,
    });

    this.socket.on("connect", () => {
      debug.info("Connected to server", {
        id: this.socket?.id,
        url: serverUrl,
        transport: this.socket?.io.engine.transport.name,
      });
      this.isConnected = true;
    });

    this.socket.on("disconnect", (reason) => {
      debug.warn("Disconnected from server", { reason });
      this.isConnected = false;
    });

    this.socket.on("connect_error", (error) => {
      debug.error("Socket connection error", { error });
      this.isConnected = false;
    });

    // Add debugging for all outgoing events
    const originalEmit = this.socket.emit.bind(this.socket);
    this.socket.emit = function (event: any, ...args: any[]) {
      debug.debug("Socket sending event", { event, args });
      return originalEmit(event, ...args);
    } as typeof this.socket.emit;

    // Add debugging for all incoming events
    this.socket.onAny((event: string, ...args: any[]) => {
      debug.debug("Socket received event", { event, args });
    });

    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  joinRoom(data: JoinRoomRequest): void {
    debug.info("Attempting to join room", {
      hasSocket: !!this.socket,
      isConnected: this.isConnected,
      socketConnected: this.socket?.connected,
      data: data,
    });

    if (this.socket) {
      if (!this.socket.connected) {
        debug.error("Socket exists but not connected, cannot join room");
        return;
      }

      debug.debug("Emitting joinRoom event", { data });
      this.socket.emit("joinRoom", data);
    } else {
      debug.error("No socket available, cannot join room");
    }
  }

  joinRoomWithPassword(data: JoinRoomWithPasswordRequest): void {
    debug.info("Attempting to join room with password");

    if (this.socket) {
      if (!this.socket.connected) {
        debug.error("Socket exists but not connected, cannot join room");
        return;
      }

      debug.debug("Emitting joinRoomWithPassword event");
      this.socket.emit("joinRoomWithPassword", data);
    } else {
      debug.error("No socket available, cannot join room");
    }
  }

  setRoomPassword(data: SetRoomPasswordRequest): void {
    if (this.socket) {
      this.socket.emit("setRoomPassword", data);
    }
  }

  shareRoomLink(data: ShareRoomLinkRequest): void {
    if (this.socket) {
      this.socket.emit("shareRoomLink", data);
    }
  }

  leaveRoom(data: LeaveRoomRequest): void {
    this.socket?.emit("leaveRoom", data);
  }

  sendMessage(message: TextMessage | FileMessage): void {
    this.socket?.emit("sendMessage", message);
  }

  requestUserList(roomKey: string): void {
    this.socket?.emit("requestUserList", roomKey);
  }

  sendP2POffer(data: { to: string; offer: string }): void {
    this.socket?.emit("p2pOffer", data);
  }

  sendP2PAnswer(data: { to: string; answer: string }): void {
    if (this.socket) {
      this.socket.emit("p2pAnswer", data);
    }
  }

  sendP2PIceCandidate(data: { to: string; candidate: string }): void {
    if (this.socket) {
      this.socket.emit("p2pIceCandidate", data);
    }
  }

  onMessage(callback: (message: TextMessage | FileMessage) => void): void {
    if (this.socket) {
      this.socket.on("message", (message: WebSocketMessage) => {
        // Only pass text and file messages to the callback
        if (message.type === "text" || message.type === "file") {
          callback(message);
        }
      });
    }
  }

  onMessageHistory(callback: (messages: (TextMessage | FileMessage)[]) => void): void {
    if (this.socket) {
      this.socket.on("messageHistory", callback);
    }
  }

  onUserJoined(callback: (user: User) => void): void {
    if (this.socket) {
      this.socket.on("userJoined", callback);
    }
  }

  onUserLeft(callback: (userId: string) => void): void {
    if (this.socket) {
      this.socket.on("userLeft", callback);
    }
  }

  onUserList(callback: (users: User[]) => void): void {
    if (this.socket) {
      this.socket.on("userList", callback);
    }
  }

  onSystemMessage(
    callback: (message: {
      type: "file_deleted" | "room_destroyed" | "file_expired";
      data: any;
    }) => void,
  ): void {
    if (this.socket) {
      this.socket.on("systemMessage", callback);
    }
  }

  onRoomDestroyed(callback: (data: { roomKey: string; deletedFiles: string[] }) => void): void {
    if (this.socket) {
      this.socket.on("roomDestroyed", callback);
    }
  }

  onError(callback: (error: string) => void): void {
    if (this.socket) {
      this.socket.on("error", callback);
    }
  }

  onP2POffer(callback: (data: { from: string; offer: string }) => void): void {
    if (this.socket) {
      this.socket.on("p2pOffer", callback);
    }
  }

  onP2PAnswer(callback: (data: { from: string; answer: string }) => void): void {
    if (this.socket) {
      this.socket.on("p2pAnswer", callback);
    }
  }

  onP2PIceCandidate(callback: (data: { from: string; candidate: string }) => void): void {
    if (this.socket) {
      this.socket.on("p2pIceCandidate", callback);
    }
  }

  onPasswordRequired(callback: (data: { roomKey: string }) => void): void {
    if (this.socket) {
      this.socket.on("passwordRequired", callback);
    }
  }

  onRoomPasswordSet(callback: (data: { roomKey: string; hasPassword: boolean }) => void): void {
    if (this.socket) {
      this.socket.on("roomPasswordSet", callback);
    }
  }

  onRoomLinkGenerated(callback: (data: { roomKey: string; shareLink: string }) => void): void {
    if (this.socket) {
      this.socket.on("roomLinkGenerated", callback);
    }
  }

  getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }

  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

  on(event: string, callback: (...args: any[]) => void): void {
    if (this.socket) {
      this.socket.on(event as any, callback);
    }
  }

  off(event: string, callback?: (...args: any[]) => void): void {
    if (this.socket) {
      this.socket.off(event as any, callback);
    }
  }
}

export const socketService = new SocketService();
