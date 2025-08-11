import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  User,
  TextMessage,
  FileMessage,
  JoinRoomRequest,
  LeaveRoomRequest,
} from '@cloud-clipboard/shared';

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private isConnected = false;

  connect(): Socket<ServerToClientEvents, ClientToServerEvents> {
    if (this.socket && this.isConnected) {
      return this.socket;
    }

    const serverUrl = (import.meta.env as any).VITE_SERVER_URL || 'http://localhost:3001';
    
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000,
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.isConnected = true;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      this.isConnected = false;
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.isConnected = false;
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
    if (this.socket) {
      this.socket.emit('joinRoom', data);
    }
  }

  leaveRoom(data: LeaveRoomRequest): void {
    if (this.socket) {
      this.socket.emit('leaveRoom', data);
    }
  }

  sendMessage(message: TextMessage | FileMessage): void {
    if (this.socket) {
      this.socket.emit('sendMessage', message);
    }
  }

  requestUserList(roomKey: string): void {
    if (this.socket) {
      this.socket.emit('requestUserList', roomKey);
    }
  }

  sendP2POffer(data: { to: string; offer: string }): void {
    if (this.socket) {
      this.socket.emit('p2pOffer', data);
    }
  }

  sendP2PAnswer(data: { to: string; answer: string }): void {
    if (this.socket) {
      this.socket.emit('p2pAnswer', data);
    }
  }

  sendP2PIceCandidate(data: { to: string; candidate: string }): void {
    if (this.socket) {
      this.socket.emit('p2pIceCandidate', data);
    }
  }

  onMessage(callback: (message: TextMessage | FileMessage) => void): void {
    if (this.socket) {
      this.socket.on('message', callback);
    }
  }

  onUserJoined(callback: (user: User) => void): void {
    if (this.socket) {
      this.socket.on('userJoined', callback);
    }
  }

  onUserLeft(callback: (userId: string) => void): void {
    if (this.socket) {
      this.socket.on('userLeft', callback);
    }
  }

  onUserList(callback: (users: User[]) => void): void {
    if (this.socket) {
      this.socket.on('userList', callback);
    }
  }

  onError(callback: (error: string) => void): void {
    if (this.socket) {
      this.socket.on('error', callback);
    }
  }

  onP2POffer(callback: (data: { from: string; offer: string }) => void): void {
    if (this.socket) {
      this.socket.on('p2pOffer', callback);
    }
  }

  onP2PAnswer(callback: (data: { from: string; answer: string }) => void): void {
    if (this.socket) {
      this.socket.on('p2pAnswer', callback);
    }
  }

  onP2PIceCandidate(callback: (data: { from: string; candidate: string }) => void): void {
    if (this.socket) {
      this.socket.on('p2pIceCandidate', callback);
    }
  }

  getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }

  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }
}

export const socketService = new SocketService();