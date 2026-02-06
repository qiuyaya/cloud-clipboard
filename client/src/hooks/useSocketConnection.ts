import { useEffect, useState, useCallback, useRef } from "react";
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
  RoomKey,
} from "@cloud-clipboard/shared";

interface UseSocketConnectionProps {
  onSetCurrentUser: (user: User | null | ((prev: User | null) => User | null)) => void;
  onSetUsers: (users: User[] | ((prev: User[]) => User[])) => void;
  onSetMessages: (
    messages:
      | (TextMessage | FileMessage)[]
      | ((prev: (TextMessage | FileMessage)[]) => (TextMessage | FileMessage)[]),
  ) => void;
  onSetIsConnecting: (connecting: boolean) => void;
  onSetShowPasswordInput: (show: boolean) => void;
  onSetHasRoomPassword: (hasPassword: boolean) => void;
  onLeaveRoom: () => void;
  fetchRoomMessages: (roomKey: string) => Promise<void>;
  roomKey: RoomKey | null;
  currentUser: User | null;
}

export const useSocketConnection = ({
  onSetCurrentUser,
  onSetUsers,
  onSetMessages,
  onSetIsConnecting,
  onSetShowPasswordInput,
  onSetHasRoomPassword,
  onLeaveRoom,
  fetchRoomMessages,
  roomKey,
  currentUser,
}: UseSocketConnectionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  // Use refs to store the latest values for event handlers
  const roomKeyRef = useRef(roomKey);
  const currentUserRef = useRef(currentUser);
  const callbacksRef = useRef({
    onSetCurrentUser,
    onSetUsers,
    onSetMessages,
    onSetIsConnecting,
    onSetShowPasswordInput,
    onSetHasRoomPassword,
    onLeaveRoom,
    fetchRoomMessages,
  });

  // Update refs when props change
  useEffect(() => {
    roomKeyRef.current = roomKey;
    currentUserRef.current = currentUser;
    callbacksRef.current = {
      onSetCurrentUser,
      onSetUsers,
      onSetMessages,
      onSetIsConnecting,
      onSetShowPasswordInput,
      onSetHasRoomPassword,
      onLeaveRoom,
      fetchRoomMessages,
    };
  });

  useEffect(() => {
    debug.info("Setting up socket connection and event handlers");
    const socket = socketService.connect();

    const handleConnect = async () => {
      debug.info("Socket connected successfully", {
        socketConnected: socketService.isSocketConnected(),
      });
      setIsConnected(true);

      const savedUser = loadFromLocalStorage("cloudClipboard_user");
      const savedRoomKey = loadFromLocalStorage("cloudClipboard_roomKey");

      if (savedUser && savedRoomKey) {
        debug.info("Checking if room and user still exist before auto-rejoining", { savedRoomKey });

        let fingerprint;
        try {
          const cachedFingerprint = loadFromLocalStorage("cloudClipboard_fingerprint");
          if (
            cachedFingerprint &&
            typeof cachedFingerprint === "object" &&
            cachedFingerprint.hash &&
            cachedFingerprint.userAgent !== undefined
          ) {
            fingerprint = cachedFingerprint;
          } else {
            fingerprint = generateBrowserFingerprint();
            saveToLocalStorage("cloudClipboard_fingerprint", fingerprint);
          }
        } catch {
          fingerprint = generateBrowserFingerprint();
          saveToLocalStorage("cloudClipboard_fingerprint", fingerprint);
        }

        try {
          const response = await fetch(getApiPath("/api/rooms/validate-user"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              roomKey: savedRoomKey,
              userFingerprint: fingerprint.hash,
            }),
          });

          const result = await response.json();

          if (result.success && result.data.roomExists && result.data.userExists) {
            debug.info("Auto-rejoining room - user exists", { savedRoomKey });
            callbacksRef.current.onSetIsConnecting(true);
            callbacksRef.current.onSetCurrentUser(null);
            callbacksRef.current.onSetUsers([]);
            callbacksRef.current.onSetMessages([]);

            const rejoinData: JoinRoomRequest = {
              type: "join_room",
              roomKey: savedRoomKey,
              user: {
                name: savedUser.name,
                deviceType: savedUser.deviceType,
              },
              fingerprint: fingerprint,
            };
            socketService.joinRoom(rejoinData);
          } else {
            debug.info("Cannot auto-rejoin - room or user no longer exists", {
              roomExists: result.data?.roomExists,
              userExists: result.data?.userExists,
            });

            localStorage.removeItem("cloudClipboard_user");
            localStorage.removeItem("cloudClipboard_roomKey");
            callbacksRef.current.onSetCurrentUser(null);
            callbacksRef.current.onSetUsers([]);
            callbacksRef.current.onSetMessages([]);

            toast({
              title: t("toast.sessionExpired"),
              description: t("toast.sessionExpiredDesc"),
              variant: "destructive",
            });
          }
        } catch (error) {
          debug.error("Failed to validate user, proceeding with normal join", {
            error,
          });
          callbacksRef.current.onSetIsConnecting(true);
          callbacksRef.current.onSetCurrentUser(null);
          callbacksRef.current.onSetUsers([]);
          callbacksRef.current.onSetMessages([]);

          const rejoinData: JoinRoomRequest = {
            type: "join_room",
            roomKey: savedRoomKey,
            user: {
              name: savedUser.name,
              deviceType: savedUser.deviceType,
            },
            fingerprint: fingerprint,
          };
          socketService.joinRoom(rejoinData);
        }
      }
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      callbacksRef.current.onSetCurrentUser(null);
      callbacksRef.current.onSetUsers([]);
      debug.warn("Disconnected from server");
    };

    const handleMessage = (message: TextMessage | FileMessage) => {
      debug.info("Received message", {
        type: message.type,
        id: message.id,
        sender: message.sender.name,
        roomKey: message.roomKey,
      });

      const messageWithDate = {
        ...message,
        timestamp:
          typeof message.timestamp === "string" ? new Date(message.timestamp) : message.timestamp,
        sender: {
          ...message.sender,
          lastSeen:
            typeof message.sender.lastSeen === "string"
              ? new Date(message.sender.lastSeen)
              : message.sender.lastSeen,
        },
      };

      debug.debug("Updating messages state", {
        currentCount: callbacksRef.current.onSetMessages.length,
      });
      callbacksRef.current.onSetMessages((prev) => {
        const newMessages = [...prev, messageWithDate];
        debug.info("Messages updated", { oldCount: prev.length, newCount: newMessages.length });
        return newMessages;
      });
    };

    const handleUserJoined = (user: User) => {
      debug.debug("User joined event received", { user });

      const userWithDate = {
        ...user,
        lastSeen: typeof user.lastSeen === "string" ? new Date(user.lastSeen) : user.lastSeen,
      };

      callbacksRef.current.onSetUsers((prev) => {
        const exists = prev.find((u) => u.id === userWithDate.id);
        if (exists) {
          return prev.map((u) => (u.id === userWithDate.id ? userWithDate : u));
        }
        return [...prev, userWithDate];
      });

      callbacksRef.current.onSetCurrentUser((prev) => {
        if (!prev) {
          debug.info("Setting current user - room join successful", {
            user: userWithDate,
          });
          callbacksRef.current.onSetIsConnecting(false);
          saveToLocalStorage("cloudClipboard_user", userWithDate);

          const currentRoomKey =
            roomKeyRef.current || loadFromLocalStorage("cloudClipboard_roomKey");
          if (currentRoomKey) {
            socketService.requestUserList(currentRoomKey);
            callbacksRef.current.fetchRoomMessages(currentRoomKey);
          }

          // setTimeout(() => {
          //   toast({
          //     title: t("toast.joinedRoom"),
          //     description: t("toast.joinedRoomDesc", {
          //       roomKey: currentRoomKey,
          //     }),
          //   });
          // }, 100);
          return userWithDate;
        } else if (prev.id !== userWithDate.id) {
          setTimeout(() => {
            toast({
              title: t("toast.userJoined"),
              description: t("toast.userJoinedDesc", {
                name: userWithDate.name,
              }),
            });
          }, 100);
        }
        return prev;
      });
    };

    const handleUserLeft = (userId: string) => {
      callbacksRef.current.onSetUsers((prev) => {
        const user = prev.find((u) => u.id === userId);
        if (user) {
          setTimeout(() => {
            toast({
              title: t("toast.userLeft"),
              description: t("toast.userLeftDesc", { name: user.name }),
            });
          }, 100);
        }
        return prev.filter((u) => u.id !== userId);
      });
    };

    const handleUserList = (userList: User[]) => {
      const usersWithDates = userList.map((user) => ({
        ...user,
        lastSeen: typeof user.lastSeen === "string" ? new Date(user.lastSeen) : user.lastSeen,
      }));
      callbacksRef.current.onSetUsers(usersWithDates);

      const savedUser = loadFromLocalStorage("cloudClipboard_user");
      if (savedUser && !currentUserRef.current) {
        const matchedUser = usersWithDates.find(
          (user) => user.name === savedUser.name || user.id === savedUser.id,
        );
        if (matchedUser) {
          callbacksRef.current.onSetCurrentUser(matchedUser);
          saveToLocalStorage("cloudClipboard_user", matchedUser);
        }
      }
    };

    const handleError = (error: string) => {
      debug.error("Socket error", { error, currentRoomKey: roomKeyRef.current });
      callbacksRef.current.onSetIsConnecting(false);

      toast({
        variant: "destructive",
        title: t("toast.connectionError"),
        description: error,
      });
    };

    const handleSystemMessage = (message: {
      type: "file_deleted" | "room_destroyed" | "file_expired";
      data: any;
    }) => {
      switch (message.type) {
        case "file_deleted":
          toast({
            title: t("toast.fileDeleted"),
            description: t("toast.fileDeletedDesc", {
              fileName: message.data.fileName,
            }),
          });
          break;
        case "room_destroyed":
          toast({
            title: t("toast.roomDestroyed"),
            description: t("toast.roomDestroyedDesc"),
          });
          break;
        case "file_expired":
          toast({
            title: t("toast.fileRetentionExpired"),
            description: t("toast.fileRetentionExpiredDesc", {
              fileName: message.data.fileName,
            }),
          });
          break;
      }
    };

    const handleRoomDestroyed = (data: { roomKey: string; deletedFiles: string[] }) => {
      if (data.deletedFiles.length > 0) {
        toast({
          title: t("toast.roomDestroyed"),
          description:
            t("toast.roomDestroyedDesc") + ` (${data.deletedFiles.length} files deleted)`,
        });
      }
      callbacksRef.current.onLeaveRoom();
    };

    const handlePasswordRequired = () => {
      callbacksRef.current.onSetIsConnecting(false);
      callbacksRef.current.onSetShowPasswordInput(true);

      toast({
        title: t("toast.passwordRequired"),
        description: t("toast.passwordRequiredDesc"),
      });
    };

    const handleRoomPasswordSet = (data: { roomKey: string; hasPassword: boolean }) => {
      callbacksRef.current.onSetHasRoomPassword(data.hasPassword);
      // Removed toast - UI will handle feedback
    };

    const handleRoomLinkGenerated = (data: { roomKey: string; shareLink: string }) => {
      // Copy share link to clipboard
      navigator.clipboard.writeText(data.shareLink).catch((err) => {
        console.error("Failed to copy share link:", err);
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socketService.onMessage(handleMessage);
    socketService.onUserJoined(handleUserJoined);
    socketService.onUserLeft(handleUserLeft);
    socketService.onUserList(handleUserList);
    socketService.onError(handleError);
    socketService.onSystemMessage(handleSystemMessage);
    socketService.onRoomDestroyed(handleRoomDestroyed);
    socketService.onPasswordRequired(handlePasswordRequired);
    socketService.onRoomPasswordSet(handleRoomPasswordSet);
    socketService.onRoomLinkGenerated(handleRoomLinkGenerated);

    return () => {
      socketService.disconnect();
    };
  }, []);

  return { isConnected };
};
