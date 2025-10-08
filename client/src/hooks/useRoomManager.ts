import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "react-i18next";
import { socketService } from "@/services/socket";
import { debug } from "@/utils/debug";
import { getApiPath } from "@/utils/api";
import { generateBrowserFingerprint } from "@cloud-clipboard/shared";
import { saveToLocalStorage, loadFromLocalStorage } from "@/utils/localStorage";
import type {
  User,
  TextMessage,
  FileMessage,
  JoinRoomRequest,
  JoinRoomWithPasswordRequest,
  LeaveRoomRequest,
  RoomKey,
} from "@cloud-clipboard/shared";

export const useRoomManager = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = loadFromLocalStorage("cloudClipboard_user");
    if (saved && saved.fingerprint) {
      return {
        ...saved,
        lastSeen: new Date(saved.lastSeen),
        isOnline: true,
      };
    }
    if (saved) {
      localStorage.removeItem("cloudClipboard_user");
      localStorage.removeItem("cloudClipboard_roomKey");
    }
    return null;
  });

  const [roomKey, setRoomKey] = useState<RoomKey | null>(() => {
    return loadFromLocalStorage("cloudClipboard_roomKey");
  });

  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<(TextMessage | FileMessage)[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [hasRoomPassword, setHasRoomPassword] = useState(false);
  const [pendingRoomJoin, setPendingRoomJoin] = useState<{
    roomKey: string;
    username: string | undefined;
    fingerprint: any;
  } | null>(null);

  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cloudClipboard_fingerprint");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === "string" || !parsed.userAgent) {
          localStorage.removeItem("cloudClipboard_fingerprint");
          debug.info("Cleared invalid fingerprint cache");
        }
      }
    } catch {
      localStorage.removeItem("cloudClipboard_fingerprint");
      debug.info("Cleared corrupted fingerprint cache");
    }
  }, []);

  const fetchRoomMessages = useCallback(async (roomKey: string) => {
    try {
      const response = await fetch(getApiPath(`/api/rooms/messages?limit=50`), {
        headers: {
          "X-Room-Key": roomKey,
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const messagesWithDates = result.data.map((msg: any) => ({
            ...msg,
            timestamp: typeof msg.timestamp === "string" ? new Date(msg.timestamp) : msg.timestamp,
            sender: {
              ...msg.sender,
              lastSeen:
                typeof msg.sender.lastSeen === "string"
                  ? new Date(msg.sender.lastSeen)
                  : msg.sender.lastSeen,
            },
          }));
          setMessages(messagesWithDates);
        }
      }
    } catch (error) {
      debug.error("Failed to fetch room messages", { error });
    }
  }, []);

  const handleJoinRoom = useCallback(
    (data: JoinRoomRequest, isConnected: boolean) => {
      debug.info("handleJoinRoom called", { data });

      if (!isConnected) {
        debug.error("Cannot join room - not connected");
        toast({
          variant: "destructive",
          title: t("toast.connectionError"),
          description: t("toast.notConnected"),
        });
        return;
      }

      debug.info("Starting room join process");
      setIsConnecting(true);
      setRoomKey(data.roomKey);

      setPendingRoomJoin({
        roomKey: data.roomKey,
        username: data.user.name,
        fingerprint: data.fingerprint,
      });

      saveToLocalStorage("cloudClipboard_roomKey", data.roomKey);

      setCurrentUser(null);
      setUsers([]);
      setMessages([]);

      debug.debug("Calling socketService.joinRoom", { data });
      socketService.joinRoom(data);

      const joinTimeout = setTimeout(() => {
        if (isConnecting && !currentUser) {
          debug.warn("Join room timeout");
          setIsConnecting(false);
          toast({
            variant: "destructive",
            title: t("toast.connectionError"),
            description: "Room join timeout. Please try again.",
          });
        }
      }, 10000);

      return () => clearTimeout(joinTimeout);
    },
    [isConnecting, currentUser, toast, t],
  );

  const handleJoinRoomWithPassword = useCallback(
    (data: JoinRoomWithPasswordRequest, isConnected: boolean) => {
      debug.info("handleJoinRoomWithPassword called");

      if (!isConnected) {
        toast({
          variant: "destructive",
          title: t("toast.connectionError"),
          description: t("toast.notConnected"),
        });
        return;
      }

      setIsConnecting(true);
      setShowPasswordInput(false);
      setRoomKey(data.roomKey);

      // Clear user-related state to ensure proper room join flow
      setCurrentUser(null);
      setUsers([]);
      setMessages([]);

      // Save room key to localStorage for persistence
      saveToLocalStorage("cloudClipboard_roomKey", data.roomKey);

      socketService.joinRoomWithPassword(data);
    },
    [toast, t],
  );

  const handleCancelPassword = useCallback(() => {
    setShowPasswordInput(false);
    setIsConnecting(false);
    setPendingRoomJoin(null);

    setRoomKey(null);
    localStorage.removeItem("cloudClipboard_roomKey");
  }, []);

  const handleLeaveRoom = useCallback(() => {
    if (currentUser && roomKey) {
      const leaveData: LeaveRoomRequest = {
        type: "leave_room",
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

    localStorage.removeItem("cloudClipboard_user");
    localStorage.removeItem("cloudClipboard_roomKey");

    toast({
      title: t("toast.leftRoom"),
      description: t("toast.leftRoomDesc"),
    });
  }, [currentUser, roomKey, toast, t]);

  const handleSetRoomPassword = useCallback(
    (shouldHavePassword: boolean) => {
      if (!roomKey) return;

      const request: any = {
        type: "set_room_password" as const,
        roomKey,
      };

      if (shouldHavePassword) {
        request.password = "";
      }

      socketService.setRoomPassword(request);
    },
    [roomKey],
  );

  const handleShareRoomLink = useCallback(() => {
    if (!roomKey) return;

    socketService.shareRoomLink({
      type: "share_room_link",
      roomKey,
    });
  }, [roomKey]);

  return {
    currentUser,
    setCurrentUser,
    roomKey,
    setRoomKey,
    users,
    setUsers,
    messages,
    setMessages,
    isConnecting,
    setIsConnecting,
    showPasswordInput,
    setShowPasswordInput,
    hasRoomPassword,
    setHasRoomPassword,
    pendingRoomJoin,
    setPendingRoomJoin,
    fetchRoomMessages,
    handleJoinRoom,
    handleJoinRoomWithPassword,
    handleCancelPassword,
    handleLeaveRoom,
    handleSetRoomPassword,
    handleShareRoomLink,
  };
};
