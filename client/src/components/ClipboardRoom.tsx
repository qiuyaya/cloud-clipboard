import React, { useState, useRef, useCallback } from "react";
import { useTemporaryState } from "@/hooks/useTemporaryState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/useToast";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useKeyboard } from "@/hooks/useKeyboard";
import { MobileNav } from "@/components/MobileNav";
import { SidebarContent } from "./SidebarContent";
import { ShareModal } from "./Share/ShareModal";
import { MessageList } from "./MessageList";
import { useTranslation } from "react-i18next";
import type { FileMessage } from "@cloud-clipboard/shared";
import { Send, Upload, Share2, Lock, Unlock, LogOut } from "lucide-react";
import { useRoom } from "@/contexts/RoomContext";

export function ClipboardRoom(): JSX.Element {
  const {
    roomKey,
    currentUser,
    users,
    messages,
    onSendMessage,
    onSendFile,
    onRecallMessage,
    onLeaveRoom,
    onSetRoomPassword,
    onShareRoomLink,
    onNavigateToShare,
    hasRoomPassword,
    isPinned,
    onPinRoom,
  } = useRoom();
  const [textInput, setTextInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedFileForShare, setSelectedFileForShare] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useTemporaryState<string | null>(null, 2000);
  const [recallConfirmId, setRecallConfirmId] = useState<string | null>(null);
  const [mobilePasswordChanged, setMobilePasswordChanged] = useTemporaryState<boolean | null>(
    null,
    2000,
  );
  const [mobileShareCopied, setMobileShareCopied] = useTemporaryState(false, 2000);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { t } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const keyboard = useKeyboard();

  const handleSendText = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!textInput.trim()) return;

    onSendMessage(textInput.trim());
    setTextInput("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: t("toast.fileTooLarge"),
        description: t("toast.fileTooLargeDesc"),
      });
      return;
    }

    onSendFile(file);
    e.target.value = "";
  };

  const copyToClipboard = async (messageId: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
    } catch {
      toast({
        variant: "destructive",
        title: t("toast.failedToCopy"),
        description: t("toast.failedToCopyDesc"),
      });
    }
  };

  const downloadFile = (message: FileMessage): void => {
    if (message.downloadUrl) {
      const link = document.createElement("a");
      link.href = message.downloadUrl;
      link.download = message.fileInfo.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const shareRoom = (): void => {
    onShareRoomLink();
    setTimeout(() => {
      setMobileShareCopied(true);
    }, 500);
  };

  const toggleRoomPassword = (): void => {
    const newState = !hasRoomPassword;
    onSetRoomPassword(newState);
    setMobilePasswordChanged(newState);
  };

  const handleShareClick = (message: FileMessage): void => {
    setSelectedFileForShare({
      id: message.fileId || message.id,
      name: message.fileInfo.name,
    });
    setShareModalOpen(true);
  };

  const handleRecallConfirm = useCallback((messageId: string) => setRecallConfirmId(messageId), []);
  const handleRecallCancel = useCallback(() => setRecallConfirmId(null), []);
  const handleRecall = useCallback(
    (messageId: string) => {
      onRecallMessage(messageId);
      setRecallConfirmId(null);
    },
    [onRecallMessage],
  );

  return (
    <div className="flex h-dvh bg-gray-50 dark:bg-gray-900">
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <SidebarContent />
        </div>
      )}

      {/* 移动端抽屉式侧边栏 */}
      {isMobile && (
        <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          <SheetContent className="p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("room.sidebarTitle")}</SheetTitle>
              <SheetDescription>{t("room.sidebarDescription")}</SheetDescription>
            </SheetHeader>
            <SidebarContent />
          </SheetContent>
        </Sheet>
      )}

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col">
        {/* 移动端顶部导航栏 */}
        {isMobile && (
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 pt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-between">
            <MobileNav onOpenSidebar={() => setIsSidebarOpen(true)} />
            <div className="flex items-center gap-3">
              {/* Room Management - Left */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="mobile-sm"
                  onClick={toggleRoomPassword}
                  className="mobile-touch"
                  title={hasRoomPassword ? t("room.removePassword") : t("room.setPassword")}
                >
                  {hasRoomPassword ? (
                    <Unlock className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
                {mobilePasswordChanged !== null && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                    <span className="text-popover-foreground">
                      {mobilePasswordChanged ? t("room.passwordSet") : t("room.passwordRemoved")}
                    </span>
                  </div>
                )}
              </div>
              <div className="relative">
                <Button
                  variant="outline"
                  size="mobile-sm"
                  onClick={shareRoom}
                  className="mobile-touch"
                  title={t("room.share")}
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                </Button>
                {mobileShareCopied && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                    <span className="text-popover-foreground">{t("room.linkCopied")}</span>
                  </div>
                )}
              </div>

              {/* User Actions - Right */}
              <Button
                variant="outline"
                size="mobile-sm"
                onClick={onLeaveRoom}
                className="mobile-touch"
                title={t("room.leave")}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {/* 消息列表 */}
        <MessageList
          messages={messages}
          currentUserId={currentUser.id}
          copiedMessageId={copiedMessageId}
          recallConfirmId={recallConfirmId}
          onCopy={copyToClipboard}
          onRecallConfirm={handleRecallConfirm}
          onRecallCancel={handleRecallCancel}
          onRecall={handleRecall}
          onDownload={downloadFile}
          onShare={handleShareClick}
          keyboardHeight={keyboard.isKeyboardOpen ? keyboard.keyboardHeight : 0}
        />

        {/* 输入区域 */}
        <div
          className={`border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 pb-[env(safe-area-inset-bottom)] ${
            keyboard.isKeyboardOpen ? "fixed z-50 left-0" : ""
          }`}
          style={
            keyboard.isKeyboardOpen
              ? {
                  bottom: keyboard.viewportOffsetTop,
                  width: keyboard.viewportWidth,
                }
              : undefined
          }
        >
          <form onSubmit={handleSendText} className="flex items-stretch gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={t("input.placeholder")}
              className="flex-1"
              maxLength={50000}
            />
            <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 mobile-touch"
              aria-label={t("input.uploadFile")}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span className="lg:inline hidden">{t("input.fileButton")}</span>
            </Button>
            <Button
              type="submit"
              disabled={!textInput.trim()}
              className="mobile-touch"
              aria-label={t("input.sendButton")}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-1">{t("room.maxLimits")}</p>
        </div>
      </div>

      {/* 分享模态框 */}
      {selectedFileForShare && (
        <ShareModal
          isOpen={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false);
            setSelectedFileForShare(null);
          }}
          fileId={selectedFileForShare.id}
          fileName={selectedFileForShare.name}
        />
      )}
    </div>
  );
}
