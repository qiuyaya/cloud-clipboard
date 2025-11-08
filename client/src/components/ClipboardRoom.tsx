import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/useToast";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { MobileNav } from "@/components/MobileNav";
import { SidebarContent } from "./SidebarContent";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useTranslation } from "react-i18next";
import { formatFileSize, formatTimestamp } from "@cloud-clipboard/shared";
import type { User, TextMessage, FileMessage, RoomKey } from "@cloud-clipboard/shared";
import { Copy, Send, Upload, File, Download, Share2, Lock, Unlock, LogOut } from "lucide-react";

interface ClipboardRoomProps {
  roomKey: RoomKey;
  currentUser: User;
  users: User[];
  messages: (TextMessage | FileMessage)[];
  onSendMessage: (content: string) => void;
  onSendFile: (file: File) => void;
  onLeaveRoom: () => void;
  onSetRoomPassword: (hasPassword: boolean) => void;
  onShareRoomLink: () => void;
  hasRoomPassword?: boolean;
}

export function ClipboardRoom({
  roomKey,
  currentUser,
  users,
  messages,
  onSendMessage,
  onSendFile,
  onLeaveRoom,
  onSetRoomPassword,
  onShareRoomLink,
  hasRoomPassword = false,
}: ClipboardRoomProps): JSX.Element {
  const [textInput, setTextInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { t } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 1024px)");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: t("toast.copied"),
        description: t("toast.copiedDesc"),
      });
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
  };

  const toggleRoomPassword = (): void => {
    onSetRoomPassword(!hasRoomPassword);
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 safe-area-inset">
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <SidebarContent
            roomKey={roomKey}
            currentUser={currentUser}
            users={users}
            onLeaveRoom={onLeaveRoom}
            onSetRoomPassword={onSetRoomPassword}
            onShareRoomLink={onShareRoomLink}
            hasRoomPassword={hasRoomPassword}
            isMobile={isMobile}
          />
        </div>
      )}

      {/* 移动端抽屉式侧边栏 */}
      {isMobile && (
        <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          <SheetContent className="w-80 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>房间信息</SheetTitle>
            </SheetHeader>
            <SidebarContent
              roomKey={roomKey}
              currentUser={currentUser}
              users={users}
              onLeaveRoom={onLeaveRoom}
              onSetRoomPassword={onSetRoomPassword}
              onShareRoomLink={onShareRoomLink}
              hasRoomPassword={hasRoomPassword}
              isMobile={isMobile}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col">
        {/* 移动端顶部导航栏 */}
        {isMobile && (
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
            <MobileNav onOpenSidebar={() => setIsSidebarOpen(true)} />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="mobile-sm"
                onClick={toggleRoomPassword}
                className="mobile-touch"
                title={hasRoomPassword ? t("room.removePassword") : t("room.setPassword")}
              >
                {hasRoomPassword ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="mobile-sm"
                onClick={shareRoom}
                className="mobile-touch"
              >
                <Share2 className="h-4 w-4" />
              </Button>
              <LanguageToggle />
              <ThemeToggle />
              <Button
                variant="outline"
                size="mobile-sm"
                onClick={onLeaveRoom}
                className="mobile-touch"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 mobile-scroll">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <p>{t("room.noMessages")}</p>
            </div>
          ) : (
            messages.map((message) => (
              <Card
                key={message.id}
                className={`max-w-full lg:max-w-2xl ${
                  message.sender.id === currentUser.id ? "ml-auto" : "mr-auto"
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {message.sender.name}
                        {message.sender.id === currentUser.id && ` ${t("message.you")}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(message.timestamp)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {message.type === "text" ? (
                    <div className="space-y-2">
                      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                        <pre className="whitespace-pre-wrap text-sm font-mono">
                          {message.content}
                        </pre>
                      </div>
                      <Button
                        variant="outline"
                        size="mobile-sm"
                        onClick={() => copyToClipboard(message.content)}
                        className="flex items-center gap-2 mobile-touch"
                      >
                        <Copy className="h-3 w-3" />
                        {t("message.copy")}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <File className="h-8 w-8 text-blue-500" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{message.fileInfo.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(message.fileInfo.size)} • {message.fileInfo.type}
                          </p>
                        </div>
                      </div>
                      {message.downloadUrl && (
                        <Button
                          variant="outline"
                          size="mobile-sm"
                          onClick={() => downloadFile(message)}
                          className="flex items-center gap-2 mobile-touch"
                        >
                          <Download className="h-3 w-3" />
                          {t("message.download")}
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <form onSubmit={handleSendText} className="flex gap-2">
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
              size="mobile-sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 mobile-touch"
            >
              <Upload className="h-4 w-4" />
              <span className="lg:inline hidden">{t("input.fileButton")}</span>
            </Button>
            <Button
              type="submit"
              size="mobile-sm"
              disabled={!textInput.trim()}
              className="mobile-touch"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">{t("room.maxLimits")}</p>
        </div>
      </div>
    </div>
  );
}
