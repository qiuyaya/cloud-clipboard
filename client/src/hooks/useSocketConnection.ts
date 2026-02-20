import { useEffect, useState, useRef } from "react";
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
  onSetIsPinned: (isPinned: boolean) => void;
  onLeaveRoom: (options?: { silent?: boolean; localOnly?: boolean }) => void;
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
  onSetIsPinned,
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
    onSetIsPinned,
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
      onSetIsPinned,
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
        debug.info("Found saved user and room, attempting to rejoin", {
          savedRoomKey,
          savedUserName: savedUser.name,
          currentUserExists: !!currentUserRef.current,
          roomKeyMatches: roomKeyRef.current === savedRoomKey,
        });

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
      debug.warn("Disconnected from server - socket will attempt to reconnect");
      // Don't clear currentUser and users here - let auto-reconnect handle it
      // If the socket can't reconnect, the user can manually leave the room
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

    const handleMessageHistory = (messages: (TextMessage | FileMessage)[]) => {
      debug.info("Received message history", { count: messages.length });

      const messagesWithDates = messages.map((message) => ({
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
      }));

      callbacksRef.current.onSetMessages(messagesWithDates);
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

          return userWithDate;
        } else if (prev.id === userWithDate.id) {
          // Same user rejoining (refresh scenario) - update user and request user list
          debug.info("Same user rejoining - updating user and requesting user list", {
            user: userWithDate,
            currentRoomKey: roomKeyRef.current,
          });
          callbacksRef.current.onSetIsConnecting(false);
          saveToLocalStorage("cloudClipboard_user", userWithDate);

          // Use roomKeyRef.current first, fallback to localStorage
          const currentRoomKey =
            roomKeyRef.current || loadFromLocalStorage("cloudClipboard_roomKey");
          if (currentRoomKey) {
            debug.info("Requesting user list and messages for room", { roomKey: currentRoomKey });
            socketService.requestUserList(currentRoomKey);
            callbacksRef.current.fetchRoomMessages(currentRoomKey);
          } else {
            debug.warn("No room key available to request user list");
          }

          return userWithDate;
        } else {
          // Different user joining - show notification
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

    const translateServerError = (error: string): string => {
      const errorMap: Record<string, string> = {
        "Invalid password": t("toast.connectionErrorMessages.invalidPassword"),
        "Room not found": t("toast.connectionErrorMessages.roomNotFound"),
        "Room does not require a password": t("toast.connectionErrorMessages.roomNoPassword"),
        "Failed to join room": t("toast.connectionErrorMessages.failedToJoinRoom"),
        "Failed to join room with password": t(
          "toast.connectionErrorMessages.failedToJoinRoomWithPassword",
        ),
        "Too many join attempts. Please wait.": t("toast.connectionErrorMessages.tooManyAttempts"),
        "Too many leave attempts. Please wait.": t("toast.connectionErrorMessages.tooManyAttempts"),
        "Too many messages. Please wait.": t("toast.connectionErrorMessages.tooManyMessages"),
        "Too many requests. Please wait.": t("toast.connectionErrorMessages.tooManyAttempts"),
        "User not authenticated": t("toast.connectionErrorMessages.userNotAuthenticated"),
        "User not in room": t("toast.connectionErrorMessages.userNotInRoom"),
        "Failed to leave room": t("toast.connectionErrorMessages.failedToLeaveRoom"),
        "Failed to send message": t("toast.connectionErrorMessages.failedToSendMessage"),
        "Failed to set room password": t("toast.connectionErrorMessages.failedToSetPassword"),
        "Failed to generate share link": t(
          "toast.connectionErrorMessages.failedToGenerateShareLink",
        ),
        "Message not found": t("toast.connectionErrorMessages.messageNotFound"),
        "Cannot recall other user's message": t(
          "toast.connectionErrorMessages.cannotRecallOthersMessage",
        ),
        "Failed to recall message": t("toast.connectionErrorMessages.failedToRecallMessage"),
      };
      return errorMap[error] || error;
    };

    const handleError = (error: string) => {
      debug.error("Socket error", { error, currentRoomKey: roomKeyRef.current });
      callbacksRef.current.onSetIsConnecting(false);

      toast({
        variant: "destructive",
        title: t("toast.connectionError"),
        description: translateServerError(error),
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
      // Room already destroyed on server, just clean up local state
      // Use localOnly to avoid sending another leaveRoom event
      callbacksRef.current.onLeaveRoom({ localOnly: true });
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
    socketService.onMessageHistory(handleMessageHistory);
    socketService.onUserJoined(handleUserJoined);
    socketService.onUserLeft(handleUserLeft);
    socketService.onUserList(handleUserList);
    socketService.onError(handleError);
    socketService.onSystemMessage(handleSystemMessage);
    socketService.onRoomDestroyed(handleRoomDestroyed);
    socketService.onPasswordRequired(handlePasswordRequired);
    socketService.onRoomPasswordSet(handleRoomPasswordSet);
    socketService.onRoomLinkGenerated(handleRoomLinkGenerated);

    const handleRoomPinned = (data: { roomKey: string; isPinned: boolean }) => {
      callbacksRef.current.onSetIsPinned(data.isPinned);
    };
    socketService.onRoomPinned(handleRoomPinned);

    const handleMessageRecalled = (data: { messageId: string }) => {
      callbacksRef.current.onSetMessages((prev) => prev.filter((m) => m.id !== data.messageId));
    };
    socketService.onMessageRecalled(handleMessageRecalled);

    return () => {
      socketService.off("messageRecalled", handleMessageRecalled);
      socketService.disconnect();
    };
  }, []);

  return { isConnected };
};
