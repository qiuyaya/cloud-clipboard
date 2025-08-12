import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useTranslation } from 'react-i18next';
import type { JoinRoomRequest } from '@cloud-clipboard/shared';
import { RoomKeySchema, generateBrowserFingerprint } from '@cloud-clipboard/shared';

interface RoomJoinProps {
  onJoinRoom: (data: JoinRoomRequest) => void;
  isConnecting: boolean;
}

export function RoomJoin({ onJoinRoom, isConnecting }: RoomJoinProps): JSX.Element {
  const [roomKey, setRoomKey] = useState('');
  const [username, setUsername] = useState('');
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    
    if (!roomKey.trim() || !username.trim()) {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: t('roomJoin.errors.required'),
      });
      return;
    }

    try {
      const validatedKey = RoomKeySchema.parse(roomKey.trim());
      
      const joinData: JoinRoomRequest = {
        type: 'join_room',
        roomKey: validatedKey,
        user: {
          name: username.trim(),
          deviceType: detectDeviceType(),
        },
        fingerprint: generateBrowserFingerprint(),
      };

      onJoinRoom(joinData);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: t('roomJoin.errors.invalidKey'),
      });
    }
  };

  const detectDeviceType = (): 'mobile' | 'desktop' | 'tablet' | 'unknown' => {
    const userAgent = navigator.userAgent.toLowerCase();
    
    if (/mobile|android|iphone|phone/.test(userAgent)) {
      return 'mobile';
    }
    
    if (/tablet|ipad/.test(userAgent)) {
      return 'tablet';
    }
    
    if (/desktop|windows|mac|linux/.test(userAgent)) {
      return 'desktop';
    }
    
    return 'unknown';
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="absolute top-4 right-4 flex gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {t('roomJoin.title')}
          </CardTitle>
          <CardDescription>
            {t('roomJoin.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="roomKey" className="text-sm font-medium">
                {t('roomJoin.roomKey')}
              </label>
              <Input
                id="roomKey"
                type="text"
                placeholder={t('roomJoin.roomKeyPlaceholder')}
                value={roomKey}
                onChange={(e) => setRoomKey(e.target.value)}
                disabled={isConnecting}
                className="w-full"
              />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                {t('roomJoin.username')}
              </label>
              <Input
                id="username"
                type="text"
                placeholder={t('roomJoin.usernamePlaceholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isConnecting}
                className="w-full"
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={isConnecting || !roomKey.trim() || !username.trim()}
            >
              {isConnecting ? t('roomJoin.joining') : t('roomJoin.joinButton')}
            </Button>
          </form>
          
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('roomJoin.shareHint')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}