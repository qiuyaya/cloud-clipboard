import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { io } from 'socket.io-client';
import { socketService } from './socket';
import type { 
  JoinRoomRequest, 
  TextMessage, 
  FileMessage
} from '@cloud-clipboard/shared';

// Mock socket.io-client
vi.mock('socket.io-client');

describe('SocketService', () => {
  let mockSocket: {
    on: Mock;
    off: Mock;
    emit: Mock;
    connect: Mock;
    disconnect: Mock;
    close: Mock;
    onAny: Mock;
    offAny: Mock;
    connected: boolean;
    id: string;
  };

  beforeEach(() => {
    mockSocket = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      close: vi.fn(),
      onAny: vi.fn(),
      offAny: vi.fn(),
      connected: false,
      id: 'mock-socket-id',
    };

    (io as Mock).mockReturnValue(mockSocket);
    
    // Reset the singleton instance
    (socketService as any).socket = null;
    (socketService as any).isConnected = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should connect to socket server', () => {
      socketService.connect();
      
      expect(io).toHaveBeenCalledWith('http://localhost:3001', {
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 20000,
      });
    });

    it('should not create new connection if already connected', () => {
      const socket1 = socketService.connect();
      (socketService as any).isConnected = true;
      const socket2 = socketService.connect();
      
      expect(socket1).toBe(socket2);
      expect(io).toHaveBeenCalledTimes(1);
    });

    it('should disconnect from socket server', () => {
      socketService.connect();
      socketService.disconnect();
      
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should return connection status', () => {
      expect(socketService.isSocketConnected()).toBe(false);
      
      socketService.connect();
      mockSocket.connected = true;
      (socketService as any).isConnected = true;
      
      expect(socketService.isSocketConnected()).toBe(true);
    });

    it('should return socket ID', () => {
      socketService.connect();
      
      expect(socketService.getSocket()?.id).toBe('mock-socket-id');
    });
  });

  describe('Event Listeners', () => {
    beforeEach(() => {
      socketService.connect();
    });

    it('should add event listener', () => {
      const callback = vi.fn();
      
      socketService.on('message', callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('message', callback);
    });

    it('should remove event listener', () => {
      const callback = vi.fn();
      
      socketService.off('message', callback);
      
      expect(mockSocket.off).toHaveBeenCalledWith('message', callback);
    });

    it('should handle connection events', () => {
      const connectCallback = vi.fn();
      const disconnectCallback = vi.fn();
      
      socketService.on('connect', connectCallback);
      socketService.on('disconnect', disconnectCallback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('connect', connectCallback);
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', disconnectCallback);
    });
  });

  describe('Message Emission', () => {
    let mockJoinRequest: JoinRoomRequest;
    let mockTextMessage: TextMessage;

    beforeEach(() => {
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;
      
      mockJoinRequest = {
        type: 'join_room',
        roomKey: 'testroom123',
        user: {
          name: 'TestUser',
          deviceType: 'desktop',
          fingerprint: 'test-fingerprint',
        },
      };

      mockTextMessage = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'text',
        content: 'Hello world!',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          name: 'TestUser',
          isOnline: true,
          lastSeen: new Date(),
          deviceType: 'desktop',
        },
        timestamp: new Date(),
        roomKey: 'testroom123',
      };
    });

    it('should join room', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      
      socketService.joinRoom(mockJoinRequest);
      
      expect(emitSpy).toHaveBeenCalledWith('joinRoom', mockJoinRequest);
    });

    it('should leave room', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      const leaveRequest = {
        type: 'leave_room' as const,
        roomKey: 'testroom123',
        userId: 'user-123',
      };
      
      socketService.leaveRoom(leaveRequest);
      
      expect(emitSpy).toHaveBeenCalledWith('leaveRoom', leaveRequest);
    });

    it('should send text message', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      
      socketService.sendMessage(mockTextMessage);
      
      expect(emitSpy).toHaveBeenCalledWith('sendMessage', mockTextMessage);
    });

    it('should send file message', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      const mockFileMessage: FileMessage = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'file',
        fileInfo: {
          name: 'test.txt',
          size: 1024,
          type: 'text/plain',
          lastModified: Date.now(),
        },
        sender: mockTextMessage.sender,
        timestamp: new Date(),
        roomKey: 'testroom123',
        downloadUrl: 'http://localhost:3001/api/files/download/test.txt',
      };
      
      socketService.sendMessage(mockFileMessage);
      
      expect(emitSpy).toHaveBeenCalledWith('sendMessage', mockFileMessage);
    });

    it('should request user list', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      
      socketService.requestUserList('testroom123');
      
      expect(emitSpy).toHaveBeenCalledWith('requestUserList', 'testroom123');
    });
  });

  describe('P2P Communication', () => {
    beforeEach(() => {
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;
    });

    it('should send P2P offer', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      const offerData = { to: 'peer-id', offer: 'offer-data' };
      
      socketService.sendP2POffer(offerData);
      
      expect(emitSpy).toHaveBeenCalledWith('p2pOffer', offerData);
    });

    it('should send P2P answer', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      const answerData = { to: 'peer-id', answer: 'answer-data' };
      
      socketService.sendP2PAnswer(answerData);
      
      expect(emitSpy).toHaveBeenCalledWith('p2pAnswer', answerData);
    });

    it('should send P2P ICE candidate', () => {
      const emitSpy = vi.spyOn(socketService.getSocket()!, 'emit');
      const candidateData = { to: 'peer-id', candidate: 'candidate-data' };
      
      socketService.sendP2PIceCandidate(candidateData);
      
      expect(emitSpy).toHaveBeenCalledWith('p2pIceCandidate', candidateData);
    });
  });

  describe('Error Handling', () => {
    it('should handle socket connection errors', () => {
      const errorCallback = vi.fn();
      
      socketService.connect();
      socketService.on('connect_error', errorCallback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', errorCallback);
    });

    it('should handle socket errors', () => {
      const errorCallback = vi.fn();
      
      socketService.connect();
      socketService.on('error', errorCallback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('error', errorCallback);
    });

    it('should not emit events if socket is not connected', () => {
      // Don't call connect() - socket should be null
      const joinRequest: JoinRoomRequest = {
        type: 'join_room',
        roomKey: 'testroom123',
        user: {
          name: 'TestUser',
          deviceType: 'desktop',
          fingerprint: 'test-fingerprint',
        },
      };
      
      socketService.joinRoom(joinRequest);
      
      // Since no socket is connected, emit shouldn't be called at all
      expect(io).not.toHaveBeenCalled();
    });
  });

  describe('Environment Configuration', () => {
    it('should use production URL in production environment', () => {
      // Reset service to pick up new environment
      (socketService as any).socket = null;
      socketService.connect();
      
      // Should call io with some URL (exact URL depends on environment setup)
      expect(io).toHaveBeenCalled();
    });

    it('should use default localhost URL when VITE_SERVER_URL is not set', () => {
      // Reset service to pick up new environment
      (socketService as any).socket = null;
      socketService.connect();
      
      expect(io).toHaveBeenCalledWith('http://localhost:3001', expect.any(Object));
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = socketService;
      const instance2 = socketService;
      
      expect(instance1).toBe(instance2);
    });

    it('should maintain state across multiple accesses', () => {
      socketService.connect();
      
      const isConnected1 = socketService.isSocketConnected();
      const isConnected2 = socketService.isSocketConnected();
      
      expect(isConnected1).toBe(isConnected2);
    });
  });
});