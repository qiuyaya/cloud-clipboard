import React from "react";
import { RoomJoin } from "@/components/RoomJoin";
import { ClipboardRoom } from "@/components/ClipboardRoom";
import { SharePage } from "@/pages/SharePage";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { Toaster } from "@/components/ui/toaster";
import { useRoomManager } from "@/hooks/useRoomManager";
import { useSocketConnection } from "@/hooks/useSocketConnection";
import { useActivityMonitor } from "@/hooks/useActivityMonitor";
import { useMessageHandler } from "@/hooks/useMessageHandler";

export function App(): JSX.Element {
  const {
    currentUser,
    setCurrentUser,
    roomKey,
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
    fetchRoomMessages,
    handleJoinRoom,
    handleJoinRoomWithPassword,
    handleCancelPassword,
    handleLeaveRoom,
    handleSetRoomPassword,
    handleShareRoomLink,
  } = useRoomManager();

  const { isConnected } = useSocketConnection({
    onSetCurrentUser: setCurrentUser,
    onSetUsers: setUsers,
    onSetMessages: setMessages,
    onSetIsConnecting: setIsConnecting,
    onSetShowPasswordInput: setShowPasswordInput,
    onSetHasRoomPassword: setHasRoomPassword,
    onLeaveRoom: handleLeaveRoom,
    fetchRoomMessages,
    roomKey,
    currentUser,
  });

  useActivityMonitor({
    currentUser,
    onLeaveRoom: handleLeaveRoom,
  });

  const { handleSendMessage, handleSendFile } = useMessageHandler({
    currentUser,
    roomKey,
  });

  const [showSharePage, setShowSharePage] = React.useState(false);

  const handleNavigateToShare = () => {
    setShowSharePage(true);
  };

  const handleBackFromShare = () => {
    setShowSharePage(false);
  };

  if (showSharePage && currentUser) {
    return (
      <>
        <SharePage userId={currentUser.id} onBack={handleBackFromShare} />
        <PWAInstallPrompt />
        <PWAUpdatePrompt />
        <Toaster />
      </>
    );
  }

  if (!currentUser || !roomKey) {
    return (
      <>
        <RoomJoin
          onJoinRoom={(data) => handleJoinRoom(data, isConnected)}
          onJoinRoomWithPassword={(data) => handleJoinRoomWithPassword(data, isConnected)}
          isConnecting={isConnecting}
          showPasswordInput={showPasswordInput}
          onCancelPassword={handleCancelPassword}
        />
        <PWAInstallPrompt />
        <PWAUpdatePrompt />
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
        onSetRoomPassword={handleSetRoomPassword}
        onShareRoomLink={handleShareRoomLink}
        onNavigateToShare={handleNavigateToShare}
        hasRoomPassword={hasRoomPassword}
      />
      <PWAInstallPrompt />
      <PWAUpdatePrompt />
      <Toaster />
    </>
  );
}

export default App;
