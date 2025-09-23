import { useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
import { useTranslation } from 'react-i18next';
import { socketService } from '@/services/socket';
import { debug } from '@/utils/debug';
import { generateUserId, FileMessageSchema } from '@cloud-clipboard/shared';
import type { User, FileMessage, RoomKey } from '@cloud-clipboard/shared';

interface UseMessageHandlerProps {
  currentUser: User | null;
  roomKey: RoomKey | null;
}

export const useMessageHandler = ({ currentUser, roomKey }: UseMessageHandlerProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleSendMessage = useCallback(async (content: string) => {
    if (!currentUser || !roomKey) {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: 'Please wait for the connection to be established',
      });
      return;
    }

    const message = {
      type: 'text' as const,
      content,
      roomKey,
    };

    try {
      socketService.sendMessage(message as any);
    } catch {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: t('toast.validationFailed'),
      });
    }
  }, [currentUser, roomKey, toast, t]);

  const handleSendFile = useCallback(async (file: File) => {
    if (!currentUser || !roomKey) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomKey', roomKey);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'X-Room-Key': roomKey,
        },
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        const userWithDate = {
          ...currentUser,
          lastSeen: typeof currentUser.lastSeen === 'string' ? new Date(currentUser.lastSeen) : currentUser.lastSeen,
        };

        const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
        const absoluteDownloadUrl = result.data.downloadUrl.startsWith('http') 
          ? result.data.downloadUrl 
          : `${serverUrl}${result.data.downloadUrl}`;

        const message: FileMessage = {
          id: generateUserId(),
          type: 'file',
          fileInfo: {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          },
          sender: userWithDate,
          timestamp: new Date(),
          roomKey,
          downloadUrl: absoluteDownloadUrl,
        };

        const validatedMessage = FileMessageSchema.parse(message);
        socketService.sendMessage(validatedMessage);

        toast({
          title: t('toast.fileUploaded'),
          description: t('toast.fileUploadedDesc', { name: file.name }),
        });
      } else {
        throw new Error(result.message || 'Upload failed');
      }
    } catch (error) {
      debug.error('File upload error', { error });
      toast({
        variant: 'destructive',
        title: t('toast.uploadFailed'),
        description: error instanceof Error ? error.message : t('toast.uploadFailed'),
      });
    }
  }, [currentUser, roomKey, toast, t]);

  return {
    handleSendMessage,
    handleSendFile,
  };
};