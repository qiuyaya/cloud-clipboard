import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { formatFileSize, formatTimestamp } from "@cloud-clipboard/shared";
import type { TextMessage, FileMessage } from "@cloud-clipboard/shared";
import { Copy, File, Download, Share2, Undo2, Check, X } from "lucide-react";

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

  return (
    <Card
      className={`group max-w-full min-w-0 lg:max-w-2xl ${isOwnMessage ? "ml-auto" : "mr-auto"}`}
    >
      <CardHeader className="p-3 pb-2 sm:p-6">
        <div className="flex items-start justify-between relative">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {message.sender.name}
              {isOwnMessage && ` ${t("message.you")}`}
            </span>
            {message.sender.fingerprint && (
              <span
                className="text-xs text-muted-foreground/50 font-mono"
                title={message.sender.fingerprint}
              >
                {message.sender.fingerprint.substring(0, 8)}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(message.timestamp, i18n.language)}
            </span>
          </div>
          {recallConfirmId === message.id ? (
            <div className="flex items-center gap-2 animate-in fade-in-0 duration-150">
              <span className="text-xs text-destructive mr-1">{t("message.recallConfirm")}</span>
              <button
                onClick={() => {
                  onRecall(message.id);
                }}
                className="p-2 text-destructive hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                title={t("message.recallConfirm")}
                aria-label={t("message.recall")}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                onClick={onRecallCancel}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                title={t("message.recallCancel")}
                aria-label={t("message.recallCancel")}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:md:opacity-100">
              {message.type === "text" && (
                <button
                  onClick={() => onCopy(message.id, message.content)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title={t("message.copy")}
                  aria-label={t("message.copy")}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {message.type === "file" && message.downloadUrl && (
                <>
                  <button
                    onClick={() => onDownload?.(message)}
                    className="p-2 text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    title={t("message.download")}
                    aria-label={t("message.download")}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => onShare?.(message)}
                    className="p-2 text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    title={t("share.button")}
                    aria-label={t("share.button")}
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
              {isOwnMessage && (
                <button
                  onClick={() => onRecallConfirm(message.id)}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title={t("message.recall")}
                  aria-label={t("message.recall")}
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {copiedMessageId === message.id && (
            <div className="absolute top-full mt-2 right-0 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
              <span className="text-popover-foreground">{t("room.copied")}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
        {message.type === "text" ? (
          <div
            className={`${isOwnMessage ? "bg-blue-50 dark:bg-blue-900/30" : "bg-gray-50 dark:bg-gray-800"} p-3 rounded-lg`}
          >
            <pre className="whitespace-pre-wrap text-sm font-mono">{message.content}</pre>
          </div>
        ) : (
          <div
            className={`flex items-center gap-3 p-3 ${isOwnMessage ? "bg-blue-50 dark:bg-blue-900/30" : "bg-gray-50 dark:bg-gray-800"} rounded-lg`}
          >
            <File className="h-8 w-8 text-blue-500" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{message.fileInfo.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(message.fileInfo.size)} • {message.fileInfo.type}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
