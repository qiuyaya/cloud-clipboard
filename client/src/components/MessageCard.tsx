import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { formatFileSize, formatTimestamp } from "@cloud-clipboard/shared";
import type { TextMessage, FileMessage } from "@cloud-clipboard/shared";
import { Copy, File, Download, Share2, Undo2, Check, X } from "lucide-react";
import { LinkifiedText } from "./LinkifiedText";
import { Avatar } from "@/components/ui/avatar";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const COLLAPSED_LINE_HEIGHT = 6;

export interface MessageCardProps {
  message: TextMessage | FileMessage;
  isOwnMessage: boolean;
  copiedMessageId: string | null;
  recallConfirmId: string | null;
  onCopy: (messageId: string, content: string) => void;
  onRecallConfirm: (messageId: string) => void;
  onRecallCancel: () => void;
  onRecall: (messageId: string) => void;
  onDownload?: (message: FileMessage) => void;
  onShare?: (message: FileMessage) => void;
}

export const MessageCard = React.memo(function MessageCard({
  message,
  isOwnMessage,
  copiedMessageId,
  recallConfirmId,
  onCopy,
  onRecallConfirm,
  onRecallCancel,
  onRecall,
  onDownload,
  onShare,
}: MessageCardProps) {
  const { t, i18n } = useTranslation();
  const textRef = useRef<HTMLPreElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const [maxHeight, setMaxHeight] = useState<string | undefined>(undefined);

  // 用 DOM 实际渲染高度判断是否超过 6 行（覆盖 CSS 自动折行的场景）
  // jsdom 等无布局环境下回退到换行符计数
  useLayoutEffect(() => {
    if (message.type !== "text") {
      setNeedsCollapse(false);
      setIsCollapsed(true);
      return;
    }
    const pre = textRef.current;
    if (pre) {
      const lineHeight = parseFloat(getComputedStyle(pre).lineHeight);
      if (lineHeight > 0) {
        setNeedsCollapse(pre.scrollHeight > lineHeight * COLLAPSED_LINE_HEIGHT + 1);
        setIsCollapsed(true);
        return;
      }
    }
    setNeedsCollapse(message.content.split("\n").length > COLLAPSED_LINE_HEIGHT);
    setIsCollapsed(true);
  }, [message]);

  // 展开动画完成后清理 maxHeight，防止窗口 resize 后固定高度截断内容
  useEffect(() => {
    if (isCollapsed || !maxHeight) return;
    const timer = setTimeout(() => setMaxHeight(undefined), 350);
    return () => clearTimeout(timer);
  }, [isCollapsed, maxHeight]);

  const handleToggle = useCallback(() => {
    if (!textRef.current) return;
    const el = textRef.current;
    if (isCollapsed) {
      setMaxHeight(`${el.scrollHeight}px`);
    } else {
      setMaxHeight(`${el.scrollHeight}px`);
      requestAnimationFrame(() => {
        setMaxHeight(undefined);
      });
    }
    setIsCollapsed((prev) => !prev);
  }, [isCollapsed]);

  const bubbleClass = isOwnMessage ? "message-bubble-own" : "message-bubble-other";

  const handleCopy = useCallback(() => {
    if (message.type === "text") {
      onCopy(message.id, (message as TextMessage).content);
    }
  }, [message, onCopy]);

  return (
    <Card
      className={`group border-0 shadow-none bg-transparent max-w-full min-w-0 lg:max-w-2xl ${
        isOwnMessage ? "ml-auto" : "mr-auto"
      }`}
    >
      <div className={`flex gap-3 ${isOwnMessage ? "flex-row-reverse" : ""}`}>
        {/* Avatar */}
        <div className="shrink-0 pt-1">
          <Avatar
            name={message.sender.name || "?"}
            seed={message.sender.fingerprint || message.sender.id}
          />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header Row */}
          <div className={`flex items-center gap-2 mb-1 ${isOwnMessage ? "flex-row-reverse" : ""}`}>
            <div
              className={`flex items-center gap-2 min-w-0 ${isOwnMessage ? "flex-row-reverse" : ""}`}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-semibold text-sm truncate cursor-default">
                    {message.sender.name}
                    {isOwnMessage && ` ${t("message.you")}`}
                  </span>
                </TooltipTrigger>
                {message.sender.fingerprint && (
                  <TooltipContent side="top" align={isOwnMessage ? "end" : "start"}>
                    <p className="text-xs font-mono">{message.sender.fingerprint}</p>
                  </TooltipContent>
                )}
              </Tooltip>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                {formatTimestamp(message.timestamp, i18n.language)}
              </span>
            </div>

            {/* Action buttons - always visible */}
            <div className="flex items-center gap-0.5 shrink-0">
              {message.type === "text" && (
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  title={t("message.copy")}
                  aria-label={t("message.copy")}
                >
                  {copiedMessageId === message.id ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {message.type === "file" && message.downloadUrl && (
                <>
                  <button
                    onClick={() => onDownload?.(message as FileMessage)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title={t("message.download")}
                    aria-label={t("message.download")}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onShare?.(message as FileMessage)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title={t("share.button")}
                    aria-label={t("share.button")}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              {isOwnMessage &&
                (recallConfirmId === message.id ? (
                  <div className="flex items-center gap-1 animate-in fade-in-0 duration-150">
                    <span className="text-[10px] text-destructive font-medium mr-1">
                      {t("message.recallConfirm")}
                    </span>
                    <button
                      onClick={() => onRecall(message.id)}
                      className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                      title={t("message.recallConfirm")}
                      aria-label={t("message.recall")}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      onClick={onRecallCancel}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title={t("message.recallCancel")}
                      aria-label={t("message.recallCancel")}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onRecallConfirm(message.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title={t("message.recall")}
                    aria-label={t("message.recall")}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                ))}
            </div>
          </div>

          {/* Message Bubble */}
          <div
            className={`relative rounded-2xl px-4 py-3 ${bubbleClass} ${
              isOwnMessage ? "rounded-tr-sm" : "rounded-tl-sm"
            }`}
          >
            {message.type === "text" ? (
              <div
                style={maxHeight ? { maxHeight, transition: "max-height 0.3s ease" } : undefined}
                className={
                  isCollapsed && needsCollapse
                    ? `message-collapsed message-collapse-gradient ${bubbleClass}`
                    : ""
                }
              >
                <pre
                  ref={textRef}
                  className="whitespace-pre-wrap text-sm font-mono leading-relaxed"
                >
                  <LinkifiedText text={message.content} />
                </pre>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <File className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{message.fileInfo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(message.fileInfo.size)} • {message.fileInfo.type}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Collapse toggle */}
          {needsCollapse && (
            <div className={isOwnMessage ? "text-right" : ""}>
              <button
                onClick={handleToggle}
                className="mt-1.5 text-xs text-muted-foreground hover:text-primary transition-colors font-medium"
                aria-label={isCollapsed ? t("message.expand") : t("message.collapse")}
              >
                {isCollapsed ? t("message.expand") : t("message.collapse")}
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});
