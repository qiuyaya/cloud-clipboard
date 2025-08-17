import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { RoomService } from './RoomService';
import type { User, TextMessage, FileMessage } from '@cloud-clipboard/shared';

describe('RoomService', () => {
  let roomService: RoomService;
  let mockUser: User;
  let mockTextMessage: TextMessage;
  let mockFileMessage: FileMessage;

  beforeEach(() => {
    roomService = new RoomService();
    
    mockUser = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'TestUser',
      isOnline: true,
      lastSeen: new Date(),
      deviceType: 'desktop',
      fingerprint: 'test-fingerprint',
    };

    mockTextMessage = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      type: 'text',
      content: 'Hello, world!',
      sender: mockUser,
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
      sender: mockUser,
      timestamp: new Date(),
      roomKey: 'testroom123',
      downloadUrl: 'http://localhost:3001/api/files/download/test.txt',
    };
  });

  afterEach(() => {
    roomService.destroy();
  });

  describe('Room Creation', () => {
    it('should create a new room', () => {
      const room = roomService.createRoom('testroom123');
      
      expect(room).toBeDefined();
      expect(room.key).toBe('testroom123');
      expect(room.getUserList()).toHaveLength(0);
    });

    it('should return existing room if it already exists', () => {
      const room1 = roomService.createRoom('testroom123');
      const room2 = roomService.createRoom('testroom123');
      
      expect(room1).toBe(room2);
    });

    it('should get room by key', () => {
      const createdRoom = roomService.createRoom('testroom123');
      const retrievedRoom = roomService.getRoom('testroom123');
      
      expect(retrievedRoom).toBe(createdRoom);
    });

    it('should return undefined for non-existent room', () => {
      const room = roomService.getRoom('nonexistent');
      
      expect(room).toBeUndefined();
    });

    it('should get or create room', () => {
      // First call should create room
      const room1 = roomService.getRoomOrCreate('testroom123');
      expect(room1).toBeDefined();
      
      // Second call should return existing room
      const room2 = roomService.getRoomOrCreate('testroom123');
      expect(room1).toBe(room2);
    });
  });

  describe('User Management', () => {
    it('should join user to room', () => {
      const room = roomService.joinRoom('testroom123', mockUser);
      
      expect(room.getUserList()).toHaveLength(1);
      const user = room.getUserList()[0];
      expect(user).toBeDefined();
      expect(user?.id).toBe(mockUser.id);
      expect(user?.name).toBe(mockUser.name);
    });

    it('should leave user from room', () => {
      roomService.joinRoom('testroom123', mockUser);
      const result = roomService.leaveRoom('testroom123', mockUser.id);
      
      expect(result).toBe(true);
      
      const users = roomService.getUsersInRoom('testroom123');
      expect(users).toHaveLength(0);
    });

    it('should return false when leaving non-existent room', () => {
      const result = roomService.leaveRoom('nonexistent', mockUser.id);
      
      expect(result).toBe(false);
    });

    it('should get users in room', () => {
      roomService.joinRoom('testroom123', mockUser);
      const users = roomService.getUsersInRoom('testroom123');
      
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(mockUser.id);
    });

    it('should return empty array for non-existent room users', () => {
      const users = roomService.getUsersInRoom('nonexistent');
      
      expect(users).toHaveLength(0);
    });

    it('should update user status', () => {
      const user2 = { ...mockUser, id: 'user-2', name: 'User2' };
      
      // Add two users to prevent room destruction
      roomService.joinRoom('testroom123', mockUser);
      roomService.joinRoom('testroom123', user2);
      
      // Update first user status to offline
      roomService.updateUserStatus('testroom123', mockUser.id, false);
      
      const users = roomService.getUsersInRoom('testroom123');
      const updatedUser = users.find(u => u.id === mockUser.id);
      expect(updatedUser?.isOnline).toBe(false);
      
      // Second user should still be online
      const onlineUser = users.find(u => u.id === user2.id);
      expect(onlineUser?.isOnline).toBe(true);
    });
  });

  describe('Message Management', () => {
    beforeEach(() => {
      roomService.joinRoom('testroom123', mockUser);
    });

    it('should add text message to room', () => {
      const result = roomService.addMessage('testroom123', mockTextMessage);
      
      expect(result).toBe(true);
      
      const messages = roomService.getMessagesInRoom('testroom123');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(mockTextMessage);
    });

    it('should add file message to room', () => {
      const result = roomService.addMessage('testroom123', mockFileMessage);
      
      expect(result).toBe(true);
      
      const messages = roomService.getMessagesInRoom('testroom123');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(mockFileMessage);
    });

    it('should return false when adding message to non-existent room', () => {
      const result = roomService.addMessage('nonexistent', mockTextMessage);
      
      expect(result).toBe(false);
    });

    it('should get messages from room', () => {
      roomService.addMessage('testroom123', mockTextMessage);
      roomService.addMessage('testroom123', mockFileMessage);
      
      const messages = roomService.getMessagesInRoom('testroom123');
      
      expect(messages).toHaveLength(2);
    });

    it('should limit messages when specified', () => {
      for (let i = 0; i < 5; i++) {
        const message = { ...mockTextMessage, id: `message-${i}`, content: `Message ${i}` };
        roomService.addMessage('testroom123', message);
      }
      
      const messages = roomService.getMessagesInRoom('testroom123', 3);
      
      expect(messages).toHaveLength(3);
    });

    it('should return empty array for non-existent room messages', () => {
      const messages = roomService.getMessagesInRoom('nonexistent');
      
      expect(messages).toHaveLength(0);
    });
  });

  describe('Room Destruction', () => {
    it('should emit roomDestroyed event when all users go offline', (done) => {
      roomService.joinRoom('testroom123', mockUser);
      
      roomService.on('roomDestroyed', (roomKey: string) => {
        expect(roomKey).toBe('testroom123');
        expect(roomService.getRoom('testroom123')).toBeUndefined();
        done?.();
      });
      
      // Make user offline
      roomService.updateUserStatus('testroom123', mockUser.id, false);
    });

    it('should emit roomDestroyed event when user leaves empty room', (done) => {
      roomService.joinRoom('testroom123', mockUser);
      
      roomService.on('roomDestroyed', (roomKey: string) => {
        expect(roomKey).toBe('testroom123');
        expect(roomService.getRoom('testroom123')).toBeUndefined();
        done?.();
      });
      
      roomService.leaveRoom('testroom123', mockUser.id);
    });

    it('should not destroy room if online users remain', () => {
      const user2 = { ...mockUser, id: 'user-2', name: 'User2' };
      
      roomService.joinRoom('testroom123', mockUser);
      roomService.joinRoom('testroom123', user2);
      
      let destroyEmitted = false;
      roomService.on('roomDestroyed', () => {
        destroyEmitted = true;
      });
      
      // Make first user offline
      roomService.updateUserStatus('testroom123', mockUser.id, false);
      
      // Room should still exist because user2 is online
      setTimeout(() => {
        expect(destroyEmitted).toBe(false);
        expect(roomService.getRoom('testroom123')).toBeDefined();
      }, 100);
    });
  });

  describe('Stats', () => {
    it('should return correct room stats', () => {
      roomService.joinRoom('room1', mockUser);
      roomService.joinRoom('room2', { ...mockUser, id: 'user-2' });
      roomService.joinRoom('room2', { ...mockUser, id: 'user-3' });
      
      const stats = roomService.getRoomStats();
      
      expect(stats.totalRooms).toBe(2);
      expect(stats.totalUsers).toBe(3);
    });

    it('should return zero stats for empty service', () => {
      const stats = roomService.getRoomStats();
      
      expect(stats.totalRooms).toBe(0);
      expect(stats.totalUsers).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup inactive rooms after 24 hours', (done) => {
      // Create room with old timestamp
      const room = roomService.createRoom('oldroom123');
      roomService.joinRoom('oldroom123', mockUser);
      
      // Manually set old timestamp (25 hours ago)
      const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000);
      room.lastActivity = oldTimestamp;
      
      roomService.on('roomDestroyed', (roomKey: string) => {
        expect(roomKey).toBe('oldroom123');
        done?.();
      });
      
      // Manually trigger cleanup
      (roomService as any).cleanupInactiveRooms();
    });

    it('should not cleanup active rooms', () => {
      roomService.joinRoom('activeroom123', mockUser);
      
      let destroyEmitted = false;
      roomService.on('roomDestroyed', () => {
        destroyEmitted = true;
      });
      
      // Manually trigger cleanup
      (roomService as any).cleanupInactiveRooms();
      
      setTimeout(() => {
        expect(destroyEmitted).toBe(false);
        expect(roomService.getRoom('activeroom123')).toBeDefined();
      }, 100);
    });
  });

  describe('Service Lifecycle', () => {
    it('should clear cleanup interval on destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      roomService.destroy();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});