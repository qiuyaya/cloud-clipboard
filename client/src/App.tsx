import React, { useState, useEffect, useCallback } from 'react';
import { RoomJoin } from '@/components/RoomJoin';
import { ClipboardRoom } from '@/components/ClipboardRoom';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/useToast';
import { useTranslation } from 'react-i18next';
import { socketService } from '@/services/socket';
import {
  generateUserId,
  FileMessageSchema,
  generateBrowserFingerprint,
} from '@cloud-clipboard/shared';
import type {
  User,
  TextMessage,
  FileMessage,
  JoinRoomRequest,
  LeaveRoomRequest,
  RoomKey,
} from '@cloud-clipboard/shared';

// Utility functions for localStorage persistence
const saveToLocalStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save to localStorage:', error);
  }
};

const loadFromLocalStorage = (key: string) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('Failed to load from localStorage:', error);
    return null;
  }
};

function App(): JSX.Element {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = loadFromLocalStorage('cloudClipboard_user');
    if (saved && saved.fingerprint) {
      // Only use saved user if it has fingerprint (new format)
      return {
        ...saved,
        lastSeen: new Date(saved.lastSeen),
        isOnline: true
      };
    }
    // Clear old format data
    if (saved) {
      localStorage.removeItem('cloudClipboard_user');
      localStorage.removeItem('cloudClipboard_roomKey');
    }
    return null;
  });
  const [roomKey, setRoomKey] = useState<RoomKey | null>(() => {
    return loadFromLocalStorage('cloudClipboard_roomKey');
  });
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<(TextMessage | FileMessage)[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const { toast } = useToast();
  const { t } = useTranslation();

  // Browser fingerprint is now managed by RoomJoin component

  // Fetch room messages from server
  const fetchRoomMessages = useCallback(async (roomKey: string) => {
    try {
      const response = await fetch(`/api/rooms/messages?limit=50`, {
        headers: {
          'X-Room-Key': roomKey,
        },
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          // Convert string dates to Date objects
          const messagesWithDates = result.data.map((msg: any) => ({
            ...msg,
            timestamp: typeof msg.timestamp === 'string' ? new Date(msg.timestamp) : msg.timestamp,
            sender: {
              ...msg.sender,
              lastSeen: typeof msg.sender.lastSeen === 'string' ? new Date(msg.sender.lastSeen) : msg.sender.lastSeen,
            },
          }));
          setMessages(messagesWithDates);
        }
      }
    } catch (error) {
      console.error('Failed to fetch room messages:', error);
    }
  }, []);

  // Update last activity on user interaction
  useEffect(() => {
    const updateActivity = () => setLastActivity(Date.now());
    
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
      document.addEventListener(event, updateActivity, { passive: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, updateActivity);
      });
    };
  }, []);

  // Auto-logout after 2 hours of inactivity
  useEffect(() => {
    const checkInactivity = () => {
      const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      if (currentUser && Date.now() - lastActivity > twoHours) {
        handleLeaveRoom();
        toast({
          title: t('toast.autoLogout'),
          description: t('toast.autoLogoutDesc'),
        });
      }
    };
    
    const interval = setInterval(checkInactivity, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [currentUser, lastActivity]);

  // Try to rejoin room on app load if data exists
  useEffect(() => {
    if (currentUser && roomKey && !isConnected && !isConnecting) {
      // Don't set isConnecting here - let the connection handler do it
      console.log('Will attempt to rejoin room once connected:', roomKey);
    }
  }, [currentUser, roomKey, isConnected, isConnecting]);

  // Set up socket connection and event handlers once
  useEffect(() => {
    const socket = socketService.connect();

    const handleConnect = () => {
      setIsConnected(true);
      console.log('Connected to server');
      
      // Auto-rejoin room if we have saved data
      const savedUser = loadFromLocalStorage('cloudClipboard_user');
      const savedRoomKey = loadFromLocalStorage('cloudClipboard_roomKey');
      
      // Always rejoin if we have saved data, regardless of currentUser state
      if (savedUser && savedRoomKey) {
        console.log('Auto-rejoining room:', savedRoomKey);
        setIsConnecting(true);
        // Reset current user to force proper reconnection flow
        setCurrentUser(null);
        setUsers([]);
        setMessages([]);
        
        // Use cached fingerprint for consistency
        const cachedFingerprint = loadFromLocalStorage('cloudClipboard_fingerprint');
        const fingerprint = cachedFingerprint || generateBrowserFingerprint();
        
        const rejoinData: JoinRoomRequest = {
          type: 'join_room',
          roomKey: savedRoomKey,
          user: {
            name: savedUser.name,
            deviceType: savedUser.deviceType
          },
          fingerprint: fingerprint
        };
        socketService.joinRoom(rejoinData);
      }
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      setCurrentUser(null);
      setUsers([]);
      console.log('Disconnected from server');
    };

    const handleMessage = (message: TextMessage | FileMessage) => {
      // Ensure timestamp is a Date object
      const messageWithDate = {
        ...message,
        timestamp: typeof message.timestamp === 'string' ? new Date(message.timestamp) : message.timestamp,
        sender: {
          ...message.sender,
          lastSeen: typeof message.sender.lastSeen === 'string' ? new Date(message.sender.lastSeen) : message.sender.lastSeen,
        }
      };
      setMessages(prev => [...prev, messageWithDate]);
    };

    const handleUserJoined = (user: User) => {
      // Ensure lastSeen is a Date object
      const userWithDate = {
        ...user,
        lastSeen: typeof user.lastSeen === 'string' ? new Date(user.lastSeen) : user.lastSeen,
      };
      
      setUsers(prev => {
        const exists = prev.find(u => u.id === userWithDate.id);
        if (exists) {
          return prev.map(u => u.id === userWithDate.id ? userWithDate : u);
        }
        return [...prev, userWithDate];
      });

      // Check if this is us joining (we don't have currentUser yet)
      setCurrentUser(prev => {
        if (!prev) {
          setIsConnecting(false);
          // Save to localStorage
          saveToLocalStorage('cloudClipboard_user', userWithDate);
          
          // This is us joining - request user list and messages for the room
          const currentRoomKey = roomKey || loadFromLocalStorage('cloudClipboard_roomKey');
          if (currentRoomKey) {
            // Request fresh user list to make sure we have everyone
            socketService.requestUserList(currentRoomKey);
            
            // Also fetch recent messages for the room
            fetchRoomMessages(currentRoomKey);
          }
          
          // Show success toast
          setTimeout(() => {
            toast({
              title: t('toast.joinedRoom'),
              description: t('toast.joinedRoomDesc', { roomKey: currentRoomKey }),
            });
          }, 100);
          return userWithDate;
        } else if (prev.id !== userWithDate.id) {
          // This is another user joining, show notification
          setTimeout(() => {
            toast({
              title: t('toast.userJoined'),
              description: t('toast.userJoinedDesc', { name: userWithDate.name }),
            });
          }, 100);
        }
        return prev;
      });
    };

    const handleUserLeft = (userId: string) => {
      setUsers(prev => {
        const user = prev.find(u => u.id === userId);
        if (user) {
          setTimeout(() => {
            toast({
              title: t('toast.userLeft'),
              description: t('toast.userLeftDesc', { name: user.name }),
            });
          }, 100);
        }
        return prev.filter(u => u.id !== userId);
      });
    };

    const handleUserList = (userList: User[]) => {
      // Convert string dates to Date objects for all users
      const usersWithDates = userList.map(user => ({
        ...user,
        lastSeen: typeof user.lastSeen === 'string' ? new Date(user.lastSeen) : user.lastSeen,
      }));
      setUsers(usersWithDates);
      
      // If we don't have currentUser set yet but we're in the user list, set it
      const savedUser = loadFromLocalStorage('cloudClipboard_user');
      if (savedUser && !currentUser) {
        const matchedUser = usersWithDates.find(user => 
          user.name === savedUser.name || user.id === savedUser.id
        );
        if (matchedUser) {
          setCurrentUser(matchedUser);
          saveToLocalStorage('cloudClipboard_user', matchedUser);
        }
      }
    };

    const handleError = (error: string) => {
      console.error('Socket error:', error);
      setIsConnecting(false);
      toast({
        variant: 'destructive',
        title: t('toast.connectionError'),
        description: error,
      });
    };

    const handleSystemMessage = (message: { type: 'file_deleted' | 'room_destroyed' | 'file_expired'; data: any }) => {
      switch (message.type) {
        case 'file_deleted':
          toast({
            title: t('toast.fileDeleted'),
            description: t('toast.fileDeletedDesc', { fileName: message.data.fileName }),
          });
          break;
        case 'room_destroyed':
          toast({
            title: t('toast.roomDestroyed'),
            description: t('toast.roomDestroyedDesc'),
          });
          break;
        case 'file_expired':
          toast({
            title: t('toast.fileRetentionExpired'),
            description: t('toast.fileRetentionExpiredDesc', { fileName: message.data.fileName }),
          });
          break;
      }
    };

    const handleRoomDestroyed = (data: { roomKey: string; deletedFiles: string[] }) => {
      if (data.deletedFiles.length > 0) {
        toast({
          title: t('toast.roomDestroyed'),
          description: t('toast.roomDestroyedDesc') + ` (${data.deletedFiles.length} files deleted)`,
        });
      }
      // Auto-leave the room
      handleLeaveRoom();
    };

    // Attach event handlers
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socketService.onMessage(handleMessage);
    socketService.onUserJoined(handleUserJoined);
    socketService.onUserLeft(handleUserLeft);
    socketService.onUserList(handleUserList);
    socketService.onError(handleError);
    socketService.onSystemMessage(handleSystemMessage);
    socketService.onRoomDestroyed(handleRoomDestroyed);

    return () => {
      socketService.disconnect();
    };
  }, []);

  const handleJoinRoom = useCallback((data: JoinRoomRequest) => {
    if (!isConnected) {
      toast({
        variant: 'destructive',
        title: t('toast.connectionError'),
        description: t('toast.notConnected'),
      });
      return;
    }

    setIsConnecting(true);
    setRoomKey(data.roomKey);
    
    // Save to localStorage
    saveToLocalStorage('cloudClipboard_roomKey', data.roomKey);
    
    // Clear current user and messages when joining a new room
    setCurrentUser(null);
    setUsers([]);
    setMessages([]);
    
    socketService.joinRoom(data);
    
    // Set timeout to handle cases where server doesn't respond
    const joinTimeout = setTimeout(() => {
      if (isConnecting && !currentUser) {
        console.warn('Join room timeout');
        setIsConnecting(false);
        toast({
          variant: 'destructive',
          title: t('toast.connectionError'),
          description: 'Room join timeout. Please try again.',
        });
      }
    }, 10000); // 10 second timeout
    
    // Clean up timeout when component unmounts or user joins successfully
    return () => clearTimeout(joinTimeout);
  }, [isConnected, isConnecting, currentUser, toast, t]);

  const handleLeaveRoom = useCallback(() => {
    if (currentUser && roomKey) {
      const leaveData: LeaveRoomRequest = {
        type: 'leave_room',
        roomKey,
        userId: currentUser.id,
      };
      
      socketService.leaveRoom(leaveData);
    }

    setCurrentUser(null);
    setRoomKey(null);
    setUsers([]);
    setMessages([]);
    setIsConnecting(false);
    
    // Clear localStorage
    localStorage.removeItem('cloudClipboard_user');
    localStorage.removeItem('cloudClipboard_roomKey');

    toast({
      title: t('toast.leftRoom'),
      description: t('toast.leftRoomDesc'),
    });
  }, [currentUser, roomKey, toast]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!currentUser || !roomKey) {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: 'Please wait for the connection to be established',
      });
      return;
    }

    // Create a simple message object that the server will process
    const message = {
      type: 'text' as const,
      content,
      roomKey,
    };

    try {
      socketService.sendMessage(message as any);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: t('toast.validationFailed'),
      });
    }
  }, [currentUser, roomKey, toast, t]);

  const handleSendFile = useCallback(async (file: File) => {
    if (!currentUser || !roomKey) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomKey', roomKey);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'X-Room-Key': roomKey,
        },
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        // Ensure currentUser has proper Date object for lastSeen
        const userWithDate = {
          ...currentUser,
          lastSeen: typeof currentUser.lastSeen === 'string' ? new Date(currentUser.lastSeen) : currentUser.lastSeen,
        };

        // Convert relative URL to absolute URL
        const serverUrl = (import.meta.env as any).VITE_SERVER_URL || 'http://localhost:3001';
        const absoluteDownloadUrl = result.data.downloadUrl.startsWith('http') 
          ? result.data.downloadUrl 
          : `${serverUrl}${result.data.downloadUrl}`;

        const message: FileMessage = {
          id: generateUserId(),
          type: 'file',
          fileInfo: {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          },
          sender: userWithDate,
          timestamp: new Date(),
          roomKey,
          downloadUrl: absoluteDownloadUrl,
        };

        const validatedMessage = FileMessageSchema.parse(message);
        socketService.sendMessage(validatedMessage);

        toast({
          title: t('toast.fileUploaded'),
          description: t('toast.fileUploadedDesc', { name: file.name }),
        });
      } else {
        throw new Error(result.message || 'Upload failed');
      }
    } catch (error) {
      console.error('File upload error:', error);
      toast({
        variant: 'destructive',
        title: t('toast.uploadFailed'),
        description: error instanceof Error ? error.message : t('toast.uploadFailed'),
      });
    }
  }, [currentUser, roomKey, toast]);

  if (!currentUser || !roomKey) {
    return (
      <>
        <RoomJoin
          onJoinRoom={handleJoinRoom}
          isConnecting={isConnecting}
        />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <ClipboardRoom
        roomKey={roomKey}
        currentUser={currentUser}
        users={users}
        messages={messages}
        onSendMessage={handleSendMessage}
        onSendFile={handleSendFile}
        onLeaveRoom={handleLeaveRoom}
      />
      <Toaster />
    </>
  );
}

export default App;