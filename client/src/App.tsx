import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { RoomJoin } from "@/components/RoomJoin";
import { ClipboardRoom } from "@/components/ClipboardRoom";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { Toaster } from "@/components/ui/toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRoomManager } from "@/hooks/useRoomManager";
import { useSocketConnection } from "@/hooks/useSocketConnection";
import { useActivityMonitor } from "@/hooks/useActivityMonitor";
import { useMessageHandler } from "@/hooks/useMessageHandler";
import { useTranslation } from "react-i18next";
import { RoomProvider } from "@/contexts/RoomContext";

const SharePage = lazy(() => import("@/pages/SharePage"));

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
    isPinned,
    setIsPinned,
    fetchRoomMessages,
    handleJoinRoom,
    handleJoinRoomWithPassword,
    handleCancelPassword,
    handleLeaveRoom,
    handleSetRoomPassword,
    handleShareRoomLink,
    handlePinRoom,
  } = useRoomManager();

  const { isConnected } = useSocketConnection({
    onSetCurrentUser: setCurrentUser,
    onSetUsers: setUsers,
    onSetMessages: setMessages,
    onSetIsConnecting: setIsConnecting,
    onSetShowPasswordInput: setShowPasswordInput,
    onSetHasRoomPassword: setHasRoomPassword,
    onSetIsPinned: setIsPinned,
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

  const [showSharePage, setShowSharePage] = useState(false);
  const [switchRoomTarget, setSwitchRoomTarget] = useState<{
    roomKey: string;
    password?: string;
  } | null>(null);

  const { t } = useTranslation();

  // Detect URL room parameter when already in a room
  useEffect(() => {
    const checkUrlRoomParam = (): void => {
      const urlParams = new URLSearchParams(window.location.search);
      const roomKeyFromUrl = urlParams.get("room");

      if (roomKeyFromUrl && currentUser && roomKey) {
        if (roomKeyFromUrl !== roomKey) {
          const passwordFromUrl = urlParams.get("password");
          setSwitchRoomTarget({
            roomKey: roomKeyFromUrl,
            password: passwordFromUrl || undefined,
          });
        }

        // Clear URL parameters regardless of whether it's the same room
        window.history.replaceState({}, "", window.location.pathname);
      }
    };

    checkUrlRoomParam();

    // Listen for popstate (browser back/forward) and custom events
    window.addEventListener("popstate", checkUrlRoomParam);
    return () => window.removeEventListener("popstate", checkUrlRoomParam);
  }, [currentUser, roomKey]);

  const handleConfirmSwitchRoom = useCallback(() => {
    if (!switchRoomTarget) return;

    // Store target room info and current username before leaving
    const target = switchRoomTarget;
    const currentUsername = currentUser?.name;
    setSwitchRoomTarget(null);

    // Leave current room silently (no toast)
    handleLeaveRoom({ silent: true });

    // Set URL params so RoomJoin can pick them up on mount
    const url = new URL(window.location.href);
    url.searchParams.set("room", target.roomKey);
    if (target.password) {
      url.searchParams.set("password", target.password);
    }
    if (currentUsername) {
      url.searchParams.set("username", currentUsername);
    }
    window.history.replaceState({}, "", url.toString());
  }, [switchRoomTarget, handleLeaveRoom, currentUser]);

  const handleCancelSwitchRoom = useCallback(() => {
    setSwitchRoomTarget(null);
  }, []);

  const handleNavigateToShare = useCallback(() => {
    setShowSharePage(true);
  }, []);

  const handleBackFromShare = useCallback(() => {
    setShowSharePage(false);
  }, []);

  const roomContextValue = useMemo(
    () => ({
      roomKey,
      currentUser,
      users,
      messages,
      hasRoomPassword,
      isPinned,
      onSendMessage: handleSendMessage,
      onSendFile: handleSendFile,
      onLeaveRoom: handleLeaveRoom,
      onSetRoomPassword: handleSetRoomPassword,
      onShareRoomLink: handleShareRoomLink,
      onNavigateToShare: handleNavigateToShare,
      onPinRoom: handlePinRoom,
    }),
    [
      roomKey,
      currentUser,
      users,
      messages,
      hasRoomPassword,
      isPinned,
      handleSendMessage,
      handleSendFile,
      handleLeaveRoom,
      handleSetRoomPassword,
      handleShareRoomLink,
      handleNavigateToShare,
      handlePinRoom,
    ],
  );

  if (showSharePage && currentUser) {
    return (
      <>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          }
        >
          <SharePage userId={currentUser.id} onBack={handleBackFromShare} />
        </Suspense>
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
          isConnected={isConnected}
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
      <RoomProvider value={roomContextValue}>
        <ClipboardRoom />
      </RoomProvider>
      <AlertDialog
        open={!!switchRoomTarget}
        onOpenChange={(open) => !open && handleCancelSwitchRoom()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("room.switchRoomTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("room.switchRoomDesc", {
                currentRoom: roomKey,
                targetRoom: switchRoomTarget?.roomKey,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("room.switchRoomCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSwitchRoom}>
              {t("room.switchRoomConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PWAInstallPrompt />
      <PWAUpdatePrompt />
      <Toaster />
    </>
  );
}

export default App;
