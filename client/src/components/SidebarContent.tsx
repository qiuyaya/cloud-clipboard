import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Version } from "@/components/Version";
import { useTranslation } from "react-i18next";
import { useTemporaryState } from "@/hooks/useTemporaryState";
import { formatTimestamp } from "@cloud-clipboard/shared";
import { Users, LogOut, Share2, Lock, Unlock, Settings, Pin, PinOff, Copy } from "lucide-react";
import { useRoom } from "@/contexts/RoomContext";
import { Separator } from "@/components/ui/separator";

export function SidebarContent(): JSX.Element {
  const {
    roomKey,
    currentUser,
    users,
    onLeaveRoom,
    onSetRoomPassword,
    onShareRoomLink,
    onNavigateToShare,
    hasRoomPassword,
    isPinned,
    onPinRoom,
  } = useRoom();
  const { t, i18n } = useTranslation();
  const [copiedRoomKey, setCopiedRoomKey] = useTemporaryState(false, 2000);
  const [copiedShareLink, setCopiedShareLink] = useTemporaryState(false, 2000);
  const [passwordChanged, setPasswordChanged] = useTemporaryState<boolean | null>(null, 2000);
  const [pinChanged, setPinChanged] = useTemporaryState<boolean | null>(null, 2000);

  const onlineUsers = users.filter((user) => user.isOnline);

  const handleToggleRoomPassword = (): void => {
    const newState = !hasRoomPassword;
    onSetRoomPassword(newState);
    setPasswordChanged(newState);
  };

  const handleTogglePin = (): void => {
    if (!onPinRoom) return;
    const newState = !isPinned;
    onPinRoom(newState);
    setPinChanged(newState);
  };

  const handleShareRoom = async (): Promise<void> => {
    try {
      onShareRoomLink();
      setTimeout(() => {
        setCopiedShareLink(true);
      }, 500);
    } catch (err) {
      console.error("Failed to share room:", err);
    }
  };

  const handleCopyRoomKey = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(roomKey);
      setCopiedRoomKey(true);
    } catch (err) {
      console.error("Failed to copy room key:", err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Room Header */}
      <div className="p-4 border-b border-border">
        <div className="space-y-3">
          {/* Room Key + Online Count */}
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-lg font-semibold">{t("room.label")}</h2>
              <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded select-all">
                {roomKey}
              </code>
              <button
                onClick={handleCopyRoomKey}
                className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                title={t("room.clickToCopy")}
                aria-label={t("room.clickToCopy")}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              {copiedRoomKey && (
                <span className="text-xs text-primary font-medium animate-in fade-in zoom-in duration-200">
                  {t("room.copied")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("room.usersOnline", { count: onlineUsers.length })}
            </p>
          </div>

          {/* Room Management Actions */}
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleRoomPassword}
                className="flex items-center gap-1.5 mobile-touch"
                title={hasRoomPassword ? t("room.removePassword") : t("room.setPassword")}
              >
                {hasRoomPassword ? (
                  <Unlock className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
                <span className="text-xs">
                  {hasRoomPassword ? t("room.removePassword") : t("room.setPassword")}
                </span>
              </Button>
              {passwordChanged !== null && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                  <span className="text-popover-foreground">
                    {passwordChanged ? t("room.passwordSet") : t("room.passwordRemoved")}
                  </span>
                </div>
              )}
            </div>

            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={handleShareRoom}
                className="flex items-center gap-1.5 mobile-touch"
                title={t("room.share")}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className="text-xs">{t("room.share")}</span>
              </Button>
              {copiedShareLink && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                  <span className="text-popover-foreground">{t("room.linkCopied")}</span>
                </div>
              )}
            </div>

            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTogglePin}
                className="flex items-center gap-1.5 mobile-touch"
                title={isPinned ? t("room.unpin") : t("room.pin")}
              >
                {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                <span className="text-xs">{isPinned ? t("room.unpin") : t("room.pin")}</span>
              </Button>
              {pinChanged !== null && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                  <span className="text-popover-foreground">
                    {pinChanged ? t("room.pinned") : t("room.unpinned")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Secondary Actions */}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onNavigateToShare}
              className="flex items-center gap-1.5 mobile-touch text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="text-xs">{t("share.list.title")}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onLeaveRoom}
              className="flex items-center gap-1.5 mobile-touch text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="text-xs">{t("room.leave")}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto p-4 mobile-scroll">
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{t("room.usersInRoom")}</span>
            <span className="text-xs text-muted-foreground ml-auto">{users.length}</span>
          </div>
          {users.map((user) => (
            <div
              key={user.id}
              className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                user.id === currentUser.id
                  ? "bg-primary/5 border border-primary/10"
                  : "bg-muted/40 hover:bg-muted/60"
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  user.isOnline ? "bg-green-500" : "bg-gray-400"
                }`}
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

      {/* Footer */}
      <div className="p-4 border-t border-border">
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
