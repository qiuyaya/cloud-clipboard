import React, { useRef, useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TextMessage, FileMessage } from "@cloud-clipboard/shared";
import { MessageCard } from "./MessageCard";

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
}: MessageListProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const message = messages[index];
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
    <div className="relative flex-1">
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto p-4 mobile-scroll"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p>{t("room.noMessages")}</p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const message = messages[virtualItem.index];
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
        )}
      </div>
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
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in fade-in-0 zoom-in-95 duration-200 z-40"
        >
          {t("room.newMessages")}
        </button>
      )}
    </div>
  );
});
