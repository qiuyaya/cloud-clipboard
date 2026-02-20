import { createContext, useContext } from "react";
import type { User, TextMessage, FileMessage, RoomKey } from "@cloud-clipboard/shared";

export interface RoomContextValue {
  roomKey: RoomKey;
  currentUser: User;
  users: User[];
  messages: (TextMessage | FileMessage)[];
  hasRoomPassword: boolean;
  isPinned: boolean;
  onSendMessage: (content: string) => void;
  onSendFile: (file: File) => void;
  onLeaveRoom: () => void;
  onSetRoomPassword: (hasPassword: boolean) => void;
  onShareRoomLink: () => void;
  onNavigateToShare: () => void;
  onRecallMessage: (messageId: string) => void;
  onPinRoom: (pinned: boolean) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export const RoomProvider = RoomContext.Provider;

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used within RoomProvider");
  return ctx;
}
