import { describe, it, expect } from 'bun:test';
import { RoomModel } from './Room';
import type { User } from '@cloud-clipboard/shared';

describe('Room Model Coverage', () => {
  it('should handle room operations', () => {
    const room = new RoomModel('test-room');
    
    const user1: User = {
      id: 'user1',
      name: 'Test User 1',
      isOnline: true,
      lastSeen: new Date(),
      deviceType: 'desktop',
      fingerprint: 'fp1',
    };

    const user2: User = {
      id: 'user2',
      name: 'Test User 2',
      isOnline: false,
      lastSeen: new Date(Date.now() - 3600000),
      deviceType: 'mobile', 
      fingerprint: 'fp2',
    };

    // Test adding users
    room.addUser(user1);
    room.addUser(user2);
    
    // RoomModel uses Map, so check size instead of length
    expect(room.users.size).toBe(2);
    expect(room.getUserList().length).toBe(2);
    
    // Test removing users
    const removed = room.removeUser('user1');
    expect(removed).toBe(true);
    expect(room.users.size).toBe(1);
    expect(room.getUserList().length).toBe(1);
    
    // Test getting user
    const foundUser = room.getUser('user2');
    expect(foundUser).toBeDefined();
    expect(foundUser?.name).toBe('Test User 2');
    expect(foundUser?.isOnline).toBe(true); // Should be set to true by addUser
    
    // Test non-existent user
    const notFound = room.getUser('nonexistent');
    expect(notFound).toBeUndefined();
    
    // Test room properties
    expect(room.key).toBe('test-room');
    expect(room.messages.length).toBe(0);
    expect(room.createdAt instanceof Date).toBe(true);
    expect(room.lastActivity instanceof Date).toBe(true);
    
    // Test isEmpty
    room.removeUser('user2');
    expect(room.isEmpty()).toBe(true);
  });

  it('should handle edge cases', () => {
    const room = new RoomModel('edge-case-room');
    
    // Test with empty users
    expect(room.isEmpty()).toBe(true);
    expect(room.users.size).toBe(0);
    expect(room.getUserList().length).toBe(0);
    
    // Test removing non-existent user
    const removed = room.removeUser('does-not-exist');
    expect(removed).toBe(false);
    expect(room.users.size).toBe(0);
    
    // Test adding same user twice
    const user: User = {
      id: 'duplicate-user',
      name: 'Duplicate',
      isOnline: true,
      lastSeen: new Date(),
      deviceType: 'desktop',
      fingerprint: 'dup-fp',
    };
    
    room.addUser(user);
    room.addUser(user); // Add again - should overwrite
    
    // Should still only have one user
    expect(room.users.size).toBe(1);
    expect(room.getUserList().length).toBe(1);
  });

  it('should handle user status updates', () => {
    const room = new RoomModel('status-room');
    
    const user: User = {
      id: 'status-user',
      name: 'Status User',
      isOnline: false,
      lastSeen: new Date(Date.now() - 1000),
      deviceType: 'tablet',
      fingerprint: 'status-fp',
    };
    
    room.addUser(user);
    
    // Test updating user status
    room.updateUserStatus('status-user', false);
    const updatedUser = room.getUser('status-user');
    expect(updatedUser?.isOnline).toBe(false);
    
    // Test updating non-existent user
    room.updateUserStatus('nonexistent', true);
    expect(room.users.size).toBe(1);
  });

  it('should handle messages', () => {
    const room = new RoomModel('message-room');
    
    const testUser = {
      id: 'user1',
      name: 'Test User',
      isOnline: true,
      lastSeen: new Date(),
      deviceType: 'desktop' as const,
      fingerprint: 'test-fingerprint',
    };
    
    const textMessage = {
      id: 'msg1',
      type: 'text' as const,
      content: 'Hello world',
      timestamp: new Date(),
      sender: testUser,
      roomKey: 'message-room',
    };
    
    room.addMessage(textMessage);
    expect(room.messages.length).toBe(1);
    
    const messages = room.getMessages();
    expect(messages.length).toBe(1);
    if (messages[0] && 'content' in messages[0]) {
      expect(messages[0].content).toBe('Hello world');
    }
    
    // Test message limit
    const messagesWithLimit = room.getMessages(1);
    expect(messagesWithLimit.length).toBe(1);
  });

  it('should handle online users', () => {
    const room = new RoomModel('online-room');
    
    const user1: User = {
      id: 'online1',
      name: 'Online User 1',
      isOnline: true,
      lastSeen: new Date(),
      deviceType: 'desktop',
      fingerprint: 'online1-fp',
    };

    const user2: User = {
      id: 'online2',
      name: 'Online User 2',
      isOnline: false,
      lastSeen: new Date(),
      deviceType: 'mobile',
      fingerprint: 'online2-fp',
    };
    
    room.addUser(user1);
    room.addUser(user2);
    
    // Both users should be online after being added (addUser sets isOnline: true)
    const onlineUsers = room.getOnlineUsers();
    expect(onlineUsers.length).toBe(2);
    
    // Update one user to offline
    room.updateUserStatus('online2', false);
    const onlineUsersAfterUpdate = room.getOnlineUsers();
    expect(onlineUsersAfterUpdate.length).toBe(1);
    expect(onlineUsersAfterUpdate[0]?.id).toBe('online1');
  });
});