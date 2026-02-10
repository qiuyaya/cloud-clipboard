import { useCallback } from "react";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "react-i18next";
import { socketService } from "@/services/socket";
import { debug } from "@/utils/debug";
import { getApiPath } from "@/utils/api";
import { generateUserId, FileMessageSchema } from "@cloud-clipboard/shared";
import type { User, FileMessage, RoomKey } from "@cloud-clipboard/shared";

interface UseMessageHandlerProps {
  currentUser: User | null;
  roomKey: RoomKey | null;
}

export const useMessageHandler = ({ currentUser, roomKey }: UseMessageHandlerProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!currentUser || !roomKey) {
        toast({
          variant: "destructive",
          title: t("toast.error"),
          description: "Please wait for the connection to be established",
        });
        return;
      }

      const message = {
        type: "text" as const,
        content,
        roomKey,
      };

      try {
        socketService.sendMessage(message as any);
      } catch {
        toast({
          variant: "destructive",
          title: t("toast.error"),
          description: t("toast.validationFailed"),
        });
      }
    },
    [currentUser, roomKey, toast, t],
  );

  const handleSendFile = useCallback(
    async (file: File) => {
      if (!currentUser || !roomKey) {
        debug.error("Cannot send file: missing user or roomKey", {
          currentUser: !!currentUser,
          roomKey,
        });
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("roomKey", roomKey);

      debug.info("Starting file upload", { fileName: file.name, fileSize: file.size, roomKey });

      try {
        const response = await fetch(getApiPath("/api/files/upload"), {
          method: "POST",
          headers: {
            "X-Room-Key": roomKey,
          },
          body: formData,
        });

        debug.info("File upload response", { status: response.status, ok: response.ok });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || `Upload failed with status ${response.status}`);
        }

        if (result.success) {
          debug.info("File upload successful", { downloadUrl: result.data.downloadUrl });

          const userWithDate = {
            ...currentUser,
            lastSeen:
              typeof currentUser.lastSeen === "string"
                ? new Date(currentUser.lastSeen)
                : currentUser.lastSeen,
          };

          // Rust backend returns absolute URL, use directly
          const absoluteDownloadUrl = result.data.downloadUrl;

          debug.info("Creating file message", {
            fileName: file.name,
            downloadUrl: absoluteDownloadUrl,
          });

          const message: FileMessage = {
            id: generateUserId(),
            type: "file",
            fileInfo: {
              name: file.name,
              size: file.size,
              type: file.type || "application/octet-stream", // Default MIME type for unknown files
              lastModified: file.lastModified,
            },
            sender: userWithDate,
            timestamp: new Date(),
            roomKey,
            downloadUrl: absoluteDownloadUrl,
            fileId: result.data.fileId,
          };

          const validatedMessage = FileMessageSchema.parse(message);

          debug.info("Sending WebSocket message", { message: validatedMessage });

          // Check socket connection before sending
          if (!socketService.isSocketConnected()) {
            debug.error("Socket not connected, cannot send message");
            toast({
              variant: "destructive",
              title: t("toast.error"),
              description: "Connection lost. Please refresh the page.",
            });
            return;
          }

          socketService.sendMessage(validatedMessage);

          debug.info("File message sent successfully");
        } else {
          throw new Error(result.message || "Upload failed");
        }
      } catch (error) {
        debug.error("File upload error", {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
        });
        toast({
          variant: "destructive",
          title: t("toast.uploadFailed"),
          description: error instanceof Error ? error.message : t("toast.uploadFailed"),
        });
      }
    },
    [currentUser, roomKey, toast, t],
  );

  return {
    handleSendMessage,
    handleSendFile,
  };
};
