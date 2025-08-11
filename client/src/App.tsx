import React, { useState, useEffect, useCallback } from 'react';
import { RoomJoin } from '@/components/RoomJoin';
import { ClipboardRoom } from '@/components/ClipboardRoom';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/useToast';
import { useTranslation } from 'react-i18next';
import { socketService } from '@/services/socket';
import {
  generateUserId,
  TextMessageSchema,
  FileMessageSchema,
} from '@cloud-clipboard/shared';
import type {
  User,
  TextMessage,
  FileMessage,
  JoinRoomRequest,
  LeaveRoomRequest,
  RoomKey,
} from '@cloud-clipboard/shared';

function App(): JSX.Element {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomKey, setRoomKey] = useState<RoomKey | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<(TextMessage | FileMessage)[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  // Set up socket connection and event handlers once
  useEffect(() => {
    const socket = socketService.connect();

    const handleConnect = () => {
      setIsConnected(true);
      console.log('Connected to server');
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
          // This is us joining, show success toast
          setTimeout(() => {
            toast({
              title: 'Joined room',
              description: `Connected to room`,
            });
          }, 100);
          return user;
        } else if (prev.id !== user.id) {
          // This is another user joining, show notification
          setTimeout(() => {
            toast({
              title: 'User joined',
              description: `${user.name} joined the room`,
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
              title: 'User left',
              description: `${user.name} left the room`,
            });
          }, 100);
        }
        return prev.filter(u => u.id !== userId);
      });
    };

    const handleUserList = (userList: User[]) => {
      setUsers(userList);
    };

    const handleError = (error: string) => {
      toast({
        variant: 'destructive',
        title: 'Connection error',
        description: error,
      });
    };

    // Attach event handlers
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socketService.onMessage(handleMessage);
    socketService.onUserJoined(handleUserJoined);
    socketService.onUserLeft(handleUserLeft);
    socketService.onUserList(handleUserList);
    socketService.onError(handleError);

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
    
    // Clear current user and messages when joining a new room
    setCurrentUser(null);
    setUsers([]);
    setMessages([]);
    
    socketService.joinRoom(data);
    
    // Don't show success toast here - wait for server confirmation
  }, [isConnected, toast, t]);

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