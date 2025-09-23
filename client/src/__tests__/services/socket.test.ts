import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { io } from 'socket.io-client';
import { socketService } from '../../services/socket';
import type { 
  JoinRoomRequest, 
  TextMessage, 
  FileMessage,
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

    (io as any).mockReturnValue(mockSocket);
    
    // Reset the socket service state
    (socketService as any).socket = null;
    (socketService as any).isConnected = false;
  });

  afterEach(() => {
    socketService.disconnect();
    vi.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should connect to socket server', () => {
      mockSocket.connected = true;
      
      const socket = socketService.connect();
      
      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          autoConnect: true,
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
          timeout: 20000,
        })
      );
      expect(socket).toBe(mockSocket);
    });

    it('should reuse existing connection', () => {
      mockSocket.connected = true;
      
      const socket1 = socketService.connect();
      const socket2 = socketService.connect();
      
      expect(socket1).toBe(socket2);
      expect(io).toHaveBeenCalledTimes(1);
    });

    it('should disconnect from socket server', () => {
      socketService.connect();
      socketService.disconnect();
      
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(socketService.getSocket()).toBeNull();
    });

    it('should return socket instance', () => {
      socketService.connect();
      
      const socket = socketService.getSocket();
      
      expect(socket).toBe(mockSocket);
    });

    it('should return connection status', () => {
      expect(socketService.isSocketConnected()).toBe(false);
      
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;
      
      expect(socketService.isSocketConnected()).toBe(true);
    });
  });

  describe('Room Operations', () => {
    let mockJoinRequest: JoinRoomRequest;

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
    });

    it('should join room', () => {
      socketService.joinRoom(mockJoinRequest);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('joinRoom', mockJoinRequest);
    });

    it('should leave room', () => {
      const leaveRequest = {
        type: 'leave_room' as const,
        roomKey: 'testroom123',
        userId: 'user-id',
      };
      
      socketService.leaveRoom(leaveRequest);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('leaveRoom', leaveRequest);
    });

    it('should request user list', () => {
      socketService.requestUserList('testroom123');
      
      expect(mockSocket.emit).toHaveBeenCalledWith('requestUserList', 'testroom123');
    });
  });

  describe('Message Operations', () => {
    let mockTextMessage: TextMessage;
    let mockFileMessage: FileMessage;

    beforeEach(() => {
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;

      mockTextMessage = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'text',
        content: 'Hello, world!',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          name: 'TestUser',
          isOnline: true,
          lastSeen: new Date(),
          deviceType: 'desktop',
          fingerprint: 'test-fingerprint',
        },
        timestamp: new Date(),
        roomKey: 'testroom123',
      };

      mockFileMessage = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        type: 'file',
        fileInfo: {
          name: 'test.txt',
          size: 1024,
          type: 'text/plain',
          lastModified: Date.now(),
        },
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440003',
          name: 'TestUser2',
          isOnline: true,
          lastSeen: new Date(),
          deviceType: 'mobile',
          fingerprint: 'test-fingerprint-2',
        },
        timestamp: new Date(),
        roomKey: 'testroom123',
        downloadUrl: 'http://localhost:3001/api/files/download/test.txt',
      };
    });

    it('should send text message', () => {
      socketService.sendMessage(mockTextMessage);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('sendMessage', mockTextMessage);
    });

    it('should send file message', () => {
      socketService.sendMessage(mockFileMessage);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('sendMessage', mockFileMessage);
    });
  });

  describe('P2P Operations', () => {
    beforeEach(() => {
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;
    });

    it('should send P2P offer', () => {
      const offerData = { to: 'user-id', offer: 'offer-data' };
      
      socketService.sendP2POffer(offerData);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('p2pOffer', offerData);
    });

    it('should send P2P answer', () => {
      const answerData = { to: 'user-id', answer: 'answer-data' };
      
      socketService.sendP2PAnswer(answerData);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('p2pAnswer', answerData);
    });

    it('should send P2P ICE candidate', () => {
      const candidateData = { to: 'user-id', candidate: 'candidate-data' };
      
      socketService.sendP2PIceCandidate(candidateData);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('p2pIceCandidate', candidateData);
    });
  });

  describe('Event Listeners', () => {
    beforeEach(() => {
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;
    });

    it('should listen for message events', () => {
      const callback = vi.fn();
      
      socketService.onMessage(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should listen for userJoined events', () => {
      const callback = vi.fn();
      
      socketService.onUserJoined(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('userJoined', callback);
    });

    it('should listen for userLeft events', () => {
      const callback = vi.fn();
      
      socketService.onUserLeft(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('userLeft', callback);
    });

    it('should listen for userList events', () => {
      const callback = vi.fn();
      
      socketService.onUserList(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('userList', callback);
    });

    it('should listen for systemMessage events', () => {
      const callback = vi.fn();
      
      socketService.onSystemMessage(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('systemMessage', callback);
    });

    it('should listen for roomDestroyed events', () => {
      const callback = vi.fn();
      
      socketService.onRoomDestroyed(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('roomDestroyed', callback);
    });

    it('should listen for error events', () => {
      const callback = vi.fn();
      
      socketService.onError(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('error', callback);
    });

    it('should listen for P2P offer events', () => {
      const callback = vi.fn();
      
      socketService.onP2POffer(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('p2pOffer', callback);
    });

    it('should listen for P2P answer events', () => {
      const callback = vi.fn();
      
      socketService.onP2PAnswer(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('p2pAnswer', callback);
    });

    it('should listen for P2P ICE candidate events', () => {
      const callback = vi.fn();
      
      socketService.onP2PIceCandidate(callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('p2pIceCandidate', callback);
    });
  });

  describe('Generic Event Methods', () => {
    beforeEach(() => {
      mockSocket.connected = true;
      socketService.connect();
      (socketService as any).isConnected = true;
    });

    it('should add generic event listener', () => {
      const callback = vi.fn();
      
      socketService.on('customEvent', callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('customEvent', callback);
    });

    it('should remove generic event listener', () => {
      const callback = vi.fn();
      
      socketService.off('customEvent', callback);
      
      expect(mockSocket.off).toHaveBeenCalledWith('customEvent', callback);
    });
  });

  describe('Error Handling', () => {
    it('should handle operations without connected socket', () => {
      // All operations should not throw when socket is not connected
      expect(() => socketService.joinRoom({} as JoinRoomRequest)).not.toThrow();
      expect(() => socketService.leaveRoom({} as any)).not.toThrow();
      expect(() => socketService.sendMessage({} as TextMessage)).not.toThrow();
      expect(() => socketService.requestUserList('test')).not.toThrow();
      expect(() => socketService.sendP2POffer({} as any)).not.toThrow();
      expect(() => socketService.sendP2PAnswer({} as any)).not.toThrow();
      expect(() => socketService.sendP2PIceCandidate({} as any)).not.toThrow();
    });

    it('should return consistent connection status', () => {
      const isConnected1 = socketService.isSocketConnected();
      const isConnected2 = socketService.isSocketConnected();
      
      expect(isConnected1).toBe(isConnected2);
    });
  });

});