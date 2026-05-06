import { useCallback, useEffect, useRef, useReducer } from "react";
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
  BrowserFingerprint,
  SetRoomPasswordRequest,
} from "@cloud-clipboard/shared";

/** Raw message from API with dates possibly serialized as strings */
interface RawApiMessage {
  type: string;
  timestamp: string | Date;
  sender: {
    lastSeen: string | Date;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// --- Reducer types ---

type RoomState = {
  currentUser: User | null;
  roomKey: RoomKey | null;
  users: User[];
  messages: (TextMessage | FileMessage)[];
  isConnecting: boolean;
  showPasswordInput: boolean;
  hasRoomPassword: boolean;
  isPinned: boolean;
  pendingRoomJoin: {
    roomKey: string;
    username: string | undefined;
    fingerprint?: BrowserFingerprint;
  } | null;
};

type RoomAction =
  | { type: "SET_USER"; payload: User | null }
  | { type: "UPDATE_USER"; payload: (prev: User | null) => User | null }
  | { type: "SET_ROOM_KEY"; payload: RoomKey | null }
  | { type: "SET_USERS"; payload: User[] }
  | { type: "UPDATE_USERS"; payload: (prev: User[]) => User[] }
  | { type: "SET_MESSAGES"; payload: (TextMessage | FileMessage)[] }
  | {
      type: "UPDATE_MESSAGES";
      payload: (prev: (TextMessage | FileMessage)[]) => (TextMessage | FileMessage)[];
    }
  | { type: "SET_CONNECTING"; payload: boolean }
  | { type: "SET_SHOW_PASSWORD_INPUT"; payload: boolean }
  | { type: "SET_ROOM_HAS_PASSWORD"; payload: boolean }
  | { type: "SET_ROOM_PINNED"; payload: boolean }
  | { type: "SET_PENDING_ROOM_JOIN"; payload: RoomState["pendingRoomJoin"] }
  | { type: "LEAVE_ROOM" }
  | { type: "CANCEL_PASSWORD" }
  | { type: "CHECK_JOIN_TIMEOUT" };

function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "SET_USER":
      return { ...state, currentUser: action.payload };
    case "UPDATE_USER":
      return { ...state, currentUser: action.payload(state.currentUser) };
    case "SET_ROOM_KEY":
      return { ...state, roomKey: action.payload };
    case "SET_USERS":
      return { ...state, users: action.payload };
    case "UPDATE_USERS":
      return { ...state, users: action.payload(state.users) };
    case "SET_MESSAGES":
      return { ...state, messages: action.payload };
    case "UPDATE_MESSAGES":
      return { ...state, messages: action.payload(state.messages) };
    case "SET_CONNECTING":
      return { ...state, isConnecting: action.payload };
    case "SET_SHOW_PASSWORD_INPUT":
      return { ...state, showPasswordInput: action.payload };
    case "SET_ROOM_HAS_PASSWORD":
      return { ...state, hasRoomPassword: action.payload };
    case "SET_ROOM_PINNED":
      return { ...state, isPinned: action.payload };
    case "SET_PENDING_ROOM_JOIN":
      return { ...state, pendingRoomJoin: action.payload };
    case "LEAVE_ROOM":
      return {
        ...state,
        currentUser: null,
        roomKey: null,
        users: [],
        messages: [],
        isConnecting: false,
      };
    case "CANCEL_PASSWORD":
      return {
        ...state,
        showPasswordInput: false,
        isConnecting: false,
        pendingRoomJoin: null,
        roomKey: null,
      };
    case "CHECK_JOIN_TIMEOUT":
      // Only act if still connecting and no user has been set
      if (state.isConnecting && !state.currentUser) {
        return {
          ...state,
          isConnecting: false,
        };
      }
      return state;
    default:
      return state;
  }
}

function getInitialState(): RoomState {
  let currentUser: User | null = null;
  const saved = loadFromLocalStorage("cloudClipboard_user");
  if (saved && saved.fingerprint) {
    currentUser = {
      ...saved,
      lastSeen: new Date(saved.lastSeen),
      isOnline: true,
    };
  } else if (saved) {
    localStorage.removeItem("cloudClipboard_user");
    localStorage.removeItem("cloudClipboard_roomKey");
  }

  const roomKey: RoomKey | null = loadFromLocalStorage("cloudClipboard_roomKey");

  return {
    currentUser,
    roomKey,
    users: [],
    messages: [],
    isConnecting: false,
    showPasswordInput: false,
    hasRoomPassword: false,
    isPinned: false,
    pendingRoomJoin: null,
  };
}

export const useRoomManager = (joinInProgressRef?: React.RefObject<boolean>) => {
  const [state, dispatch] = useReducer(roomReducer, undefined, getInitialState);

  const { toast } = useToast();
  const { t } = useTranslation();
  const joinTimeoutRef = useRef<number | null>(null);

  // Stable setter wrappers that match the useState API (value or updater function)
  const setCurrentUser = useCallback(
    (valueOrUpdater: User | null | ((prev: User | null) => User | null)) => {
      if (typeof valueOrUpdater === "function") {
        dispatch({ type: "UPDATE_USER", payload: valueOrUpdater });
      } else {
        dispatch({ type: "SET_USER", payload: valueOrUpdater });
      }
    },
    [],
  );

  const setRoomKey = useCallback((value: RoomKey | null) => {
    dispatch({ type: "SET_ROOM_KEY", payload: value });
  }, []);

  const setUsers = useCallback((valueOrUpdater: User[] | ((prev: User[]) => User[])) => {
    if (typeof valueOrUpdater === "function") {
      dispatch({ type: "UPDATE_USERS", payload: valueOrUpdater });
    } else {
      dispatch({ type: "SET_USERS", payload: valueOrUpdater });
    }
  }, []);

  const setMessages = useCallback(
    (
      valueOrUpdater:
        | (TextMessage | FileMessage)[]
        | ((prev: (TextMessage | FileMessage)[]) => (TextMessage | FileMessage)[]),
    ) => {
      if (typeof valueOrUpdater === "function") {
        dispatch({ type: "UPDATE_MESSAGES", payload: valueOrUpdater });
      } else {
        dispatch({ type: "SET_MESSAGES", payload: valueOrUpdater });
      }
    },
    [],
  );

  const setIsConnecting = useCallback((value: boolean) => {
    dispatch({ type: "SET_CONNECTING", payload: value });
  }, []);

  const setShowPasswordInput = useCallback((value: boolean) => {
    dispatch({ type: "SET_SHOW_PASSWORD_INPUT", payload: value });
  }, []);

  const setHasRoomPassword = useCallback((value: boolean) => {
    dispatch({ type: "SET_ROOM_HAS_PASSWORD", payload: value });
  }, []);

  const setIsPinned = useCallback((value: boolean) => {
    dispatch({ type: "SET_ROOM_PINNED", payload: value });
  }, []);

  const setPendingRoomJoin = useCallback((value: RoomState["pendingRoomJoin"]) => {
    dispatch({ type: "SET_PENDING_ROOM_JOIN", payload: value });
  }, []);

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

  // Cleanup join timeout on unmount
  useEffect(() => {
    return () => {
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
    };
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
          const messagesWithDates = result.data.map((msg: RawApiMessage) => ({
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
          dispatch({ type: "SET_MESSAGES", payload: messagesWithDates });
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

      // Clear any existing timeout
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }

      debug.info("Starting room join process");
      // Synchronously mark join in progress to prevent handleConnect auto-rejoin
      if (joinInProgressRef) {
        (joinInProgressRef as React.MutableRefObject<boolean>).current = true;
      }
      setIsConnecting(true);
      dispatch({ type: "SET_ROOM_KEY", payload: data.roomKey });

      dispatch({
        type: "SET_PENDING_ROOM_JOIN",
        payload: {
          roomKey: data.roomKey,
          username: data.user.name,
          fingerprint: data.fingerprint,
        },
      });

      saveToLocalStorage("cloudClipboard_roomKey", data.roomKey);

      dispatch({ type: "SET_USER", payload: null });
      dispatch({ type: "SET_USERS", payload: [] });
      dispatch({ type: "SET_MESSAGES", payload: [] });

      debug.debug("Calling socketService.joinRoom", { data });
      socketService.joinRoom(data);

      joinTimeoutRef.current = setTimeout(() => {
        // Dispatch a self-contained action that reads current state in the reducer
        dispatch({ type: "CHECK_JOIN_TIMEOUT" });
        toast({
          variant: "destructive",
          title: t("toast.connectionError"),
          description: t("toast.joinTimeout"),
        });
        joinTimeoutRef.current = null;
      }, 10000);
    },
    [toast, t, setIsConnecting],
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

      dispatch({ type: "SET_CONNECTING", payload: true });
      dispatch({ type: "SET_SHOW_PASSWORD_INPUT", payload: false });
      dispatch({ type: "SET_ROOM_KEY", payload: data.roomKey });

      // Clear user-related state to ensure proper room join flow
      dispatch({ type: "SET_USER", payload: null });
      dispatch({ type: "SET_USERS", payload: [] });
      dispatch({ type: "SET_MESSAGES", payload: [] });

      // Save room key to localStorage for persistence
      saveToLocalStorage("cloudClipboard_roomKey", data.roomKey);

      socketService.joinRoomWithPassword(data);
    },
    [toast, t],
  );

  const handleCancelPassword = useCallback(() => {
    dispatch({ type: "CANCEL_PASSWORD" });
    localStorage.removeItem("cloudClipboard_roomKey");
  }, []);

  const handleLeaveRoom = useCallback(
    (options?: { silent?: boolean; localOnly?: boolean }) => {
      // Only send leaveRoom event to server if not local-only mode
      // localOnly is used when server has already destroyed the room
      if (!options?.localOnly && state.currentUser && state.roomKey) {
        const leaveData: LeaveRoomRequest = {
          type: "leave_room",
          roomKey: state.roomKey,
          userId: state.currentUser.id,
        };

        socketService.leaveRoom(leaveData);
      }

      dispatch({ type: "LEAVE_ROOM" });

      localStorage.removeItem("cloudClipboard_user");
      localStorage.removeItem("cloudClipboard_roomKey");

      if (!options?.silent) {
        toast({
          title: t("toast.leftRoom"),
          description: t("toast.leftRoomDesc"),
        });
      }
    },
    [state.currentUser, state.roomKey, toast, t],
  );

  const handleSetRoomPassword = useCallback(
    (shouldHavePassword: boolean) => {
      if (!state.roomKey) return;

      const request: SetRoomPasswordRequest = shouldHavePassword
        ? {
            type: "set_room_password" as const,
            roomKey: state.roomKey,
            password: "",
          }
        : {
            type: "set_room_password" as const,
            roomKey: state.roomKey,
          };

      socketService.setRoomPassword(request);
    },
    [state.roomKey],
  );

  const handleShareRoomLink = useCallback(() => {
    if (!state.roomKey) return;

    socketService.shareRoomLink({
      type: "share_room_link",
      roomKey: state.roomKey,
    });
  }, [state.roomKey]);

  const handlePinRoom = useCallback(
    (pinned: boolean) => {
      if (!state.roomKey) return;

      socketService.pinRoom({
        type: "pin_room",
        roomKey: state.roomKey,
        pinned,
      });
    },
    [state.roomKey],
  );

  return {
    currentUser: state.currentUser,
    setCurrentUser,
    roomKey: state.roomKey,
    setRoomKey,
    users: state.users,
    setUsers,
    messages: state.messages,
    setMessages,
    isConnecting: state.isConnecting,
    setIsConnecting,
    showPasswordInput: state.showPasswordInput,
    setShowPasswordInput,
    hasRoomPassword: state.hasRoomPassword,
    setHasRoomPassword,
    isPinned: state.isPinned,
    setIsPinned,
    pendingRoomJoin: state.pendingRoomJoin,
    setPendingRoomJoin,
    fetchRoomMessages,
    handleJoinRoom,
    handleJoinRoomWithPassword,
    handleCancelPassword,
    handleLeaveRoom,
    handleSetRoomPassword,
    handleShareRoomLink,
    handlePinRoom,
  };
};
