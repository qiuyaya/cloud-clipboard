import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Version } from "@/components/Version";
import { useTranslation } from "react-i18next";
import { useState, useRef, useEffect } from "react";
import { formatTimestamp } from "@cloud-clipboard/shared";
import type { User, RoomKey } from "@cloud-clipboard/shared";
import { Users, LogOut, Share2, Lock, Unlock, Settings, Pin, PinOff } from "lucide-react";

interface SidebarContentProps {
  roomKey: RoomKey;
  currentUser: User;
  users: User[];
  onLeaveRoom: () => void;
  onSetRoomPassword: (hasPassword: boolean) => void;
  onShareRoomLink: () => void;
  onNavigateToShare?: () => void;
  hasRoomPassword?: boolean;
  isPinned?: boolean;
  onPinRoom?: (pinned: boolean) => void;
  isMobile: boolean;
}

export function SidebarContent({
  roomKey,
  currentUser,
  users,
  onLeaveRoom,
  onSetRoomPassword,
  onShareRoomLink,
  onNavigateToShare,
  hasRoomPassword = false,
  isPinned = false,
  onPinRoom,
  isMobile,
}: SidebarContentProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const [copiedRoomKey, setCopiedRoomKey] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState<boolean | null>(null);
  const [pinChanged, setPinChanged] = useState<boolean | null>(null);

  // Refs to store timeout IDs for cleanup
  const passwordTimeoutRef = useRef<number | null>(null);
  const pinTimeoutRef = useRef<number | null>(null);
  const shareTimeoutRef = useRef<number | null>(null);
  const shareLinkTimeoutRef = useRef<number | null>(null);
  const roomKeyTimeoutRef = useRef<number | null>(null);

  const onlineUsers = users.filter((user) => user.isOnline);

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (passwordTimeoutRef.current) clearTimeout(passwordTimeoutRef.current);
      if (pinTimeoutRef.current) clearTimeout(pinTimeoutRef.current);
      if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
      if (shareLinkTimeoutRef.current) clearTimeout(shareLinkTimeoutRef.current);
      if (roomKeyTimeoutRef.current) clearTimeout(roomKeyTimeoutRef.current);
    };
  }, []);

  const handleToggleRoomPassword = (): void => {
    const newState = !hasRoomPassword;
    onSetRoomPassword(newState);
    // Show temporary feedback
    setPasswordChanged(newState);
    if (passwordTimeoutRef.current) {
      clearTimeout(passwordTimeoutRef.current);
    }
    passwordTimeoutRef.current = setTimeout(() => {
      setPasswordChanged(null);
      passwordTimeoutRef.current = null;
    }, 2000);
  };

  const handleTogglePin = (): void => {
    if (!onPinRoom) return;
    const newState = !isPinned;
    onPinRoom(newState);
    setPinChanged(newState);
    if (pinTimeoutRef.current) {
      clearTimeout(pinTimeoutRef.current);
    }
    pinTimeoutRef.current = setTimeout(() => {
      setPinChanged(null);
      pinTimeoutRef.current = null;
    }, 2000);
  };

  const handleShareRoom = async (): Promise<void> => {
    try {
      onShareRoomLink();
      // Give time for the link to be generated and copied
      if (shareTimeoutRef.current) {
        clearTimeout(shareTimeoutRef.current);
      }
      if (shareLinkTimeoutRef.current) {
        clearTimeout(shareLinkTimeoutRef.current);
      }
      shareTimeoutRef.current = setTimeout(() => {
        setCopiedShareLink(true);
        shareTimeoutRef.current = null;
        shareLinkTimeoutRef.current = setTimeout(() => {
          setCopiedShareLink(false);
          shareLinkTimeoutRef.current = null;
        }, 2000);
      }, 500);
    } catch (err) {
      console.error("Failed to share room:", err);
    }
  };

  const handleDoubleClickRoomKey = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(roomKey);
      setCopiedRoomKey(true);
      if (roomKeyTimeoutRef.current) {
        clearTimeout(roomKeyTimeoutRef.current);
      }
      roomKeyTimeoutRef.current = setTimeout(() => {
        setCopiedRoomKey(false);
        roomKeyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy room key:", err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="pl-6 pr-2 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="pr-3">
            <div className="relative flex items-center gap-2 group">
              <h2
                className="text-lg font-semibold cursor-pointer"
                onDoubleClick={handleDoubleClickRoomKey}
                title={t("room.doubleClickToCopy")}
              >
                <span className="select-none">{t("room.label")}</span>
                <span className="select-all hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  {roomKey}
                </span>
              </h2>
              {copiedRoomKey && (
                <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                  <span className="text-popover-foreground">{t("room.copied")}</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("room.usersOnline", { count: onlineUsers.length })}
            </p>
          </div>
          {!isMobile && (
            <div className="flex flex-col gap-1.5">
              {/* Top Row - Room Management */}
              <div className="flex items-center justify-center gap-0.5">
                {/* Password Lock */}
                <div className="min-w-0 flex-shrink-0">
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleRoomPassword}
                      className="flex items-center gap-2 min-w-fit mobile-touch"
                      title={hasRoomPassword ? t("room.removePassword") : t("room.setPassword")}
                    >
                      {hasRoomPassword ? (
                        <Unlock className="h-4 w-4" />
                      ) : (
                        <Lock className="h-4 w-4" />
                      )}
                    </Button>
                    {passwordChanged !== null && (
                      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                        <span className="text-popover-foreground">
                          {passwordChanged ? t("room.passwordSet") : t("room.passwordRemoved")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Share Room */}
                <div className="min-w-0 flex-shrink-0">
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleShareRoom}
                      className="flex items-center gap-2 min-w-fit mobile-touch"
                      title={t("room.share")}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                    {copiedShareLink && (
                      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                        <span className="text-popover-foreground">{t("room.linkCopied")}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pin Room */}
                {onPinRoom && (
                  <div className="min-w-0 flex-shrink-0">
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTogglePin}
                        className="flex items-center gap-2 min-w-fit mobile-touch"
                        title={isPinned ? t("room.unpin") : t("room.pin")}
                      >
                        {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </Button>
                      {pinChanged !== null && (
                        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                          <span className="text-popover-foreground">
                            {pinChanged ? t("room.pinned") : t("room.unpinned")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Row - User Actions */}
              <div className="flex items-center justify-center gap-0.5">
                {/* Settings */}
                {onNavigateToShare && (
                  <div className="min-w-0 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onNavigateToShare}
                      className="flex items-center gap-2 min-w-fit mobile-touch"
                      title={t("share.list.title")}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Leave Room */}
                <div className="min-w-0 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onLeaveRoom}
                    className="flex items-center gap-2 min-w-fit mobile-touch"
                    title={t("room.leave")}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 mobile-scroll">
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4" />
            <span className="font-medium text-sm">{t("room.usersInRoom")}</span>
          </div>
          {users.map((user) => (
            <div
              key={user.id}
              className={`flex items-center gap-3 p-2 rounded-lg ${
                user.id === currentUser.id
                  ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                  : "bg-gray-50 dark:bg-gray-700/50"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${user.isOnline ? "bg-green-500" : "bg-gray-400"}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user.name} {user.id === currentUser.id && t("room.you")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user.deviceType} •{" "}
                  {user.isOnline
                    ? t("room.online")
                    : t("room.lastSeen", {
                        time: formatTimestamp(user.lastSeen, i18n.language),
                      })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <Version />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
