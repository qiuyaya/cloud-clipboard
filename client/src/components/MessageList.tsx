import React, { useRef, useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TextMessage, FileMessage } from "@cloud-clipboard/shared";
import { MessageCard } from "./MessageCard";
import { Inbox } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";

interface MessageListProps {
  messages: (TextMessage | FileMessage)[];
  currentUserId: string;
  copiedMessageId: string | null;
  recallConfirmId: string | null;
  onCopy: (messageId: string, content: string) => void;
  onRecallConfirm: (messageId: string) => void;
  onRecallCancel: () => void;
  onRecall: (messageId: string) => void;
  onDownload: (message: FileMessage) => void;
  onShare: (message: FileMessage) => void;
  keyboardHeight?: number;
}

export const MessageList = React.memo(function MessageList({
  messages,
  currentUserId,
  copiedMessageId,
  recallConfirmId,
  onCopy,
  onRecallConfirm,
  onRecallCancel,
  onRecall,
  onDownload,
  onShare,
  keyboardHeight = 0,
}: MessageListProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const message = messagesRef.current[index];
      return message?.type === "file" ? 140 : 120;
    },
    overscan: 5,
    measureElement: useCallback((element: Element) => {
      return element.getBoundingClientRect().height;
    }, []),
  });

  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 150;
    isAtBottomRef.current = atBottom;
    if (atBottom) setHasNewMessages(false);
  }, []);

  useEffect(() => {
    if (messages.length > 0 && isAtBottomRef.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
    } else if (messages.length > 0) {
      setHasNewMessages(true);
    }
  }, [messages.length, virtualizer]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto p-4 mobile-scroll"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-primary/60" />
            </div>
            <p className="text-sm font-medium mb-1">{t("room.noMessagesTitle")}</p>
            <p className="text-xs text-muted-foreground/80">{t("room.noMessagesHint")}</p>
          </div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const message = messages[virtualItem.index];
                if (!message) return null;
                return (
                  <div
                    key={message.id}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className="pb-4">
                      <MessageCard
                        message={message}
                        isOwnMessage={message.sender.id === currentUserId}
                        copiedMessageId={copiedMessageId}
                        recallConfirmId={recallConfirmId}
                        onCopy={onCopy}
                        onRecallConfirm={onRecallConfirm}
                        onRecallCancel={onRecallCancel}
                        onRecall={onRecall}
                        onDownload={onDownload}
                        onShare={onShare}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </div>
      {/* Spacer for keyboard so last messages aren't hidden */}
      {keyboardHeight > 0 && <div style={{ height: keyboardHeight }} />}
      {hasNewMessages && (
        <button
          onClick={() => {
            virtualizer.scrollToIndex(messages.length - 1, {
              align: "end",
              behavior: "smooth",
            });
            setHasNewMessages(false);
            isAtBottomRef.current = true;
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in fade-in-0 zoom-in-95 duration-200 z-40 hover:bg-primary/90 transition-colors"
        >
          {t("room.newMessages")}
        </button>
      )}
    </div>
  );
});
