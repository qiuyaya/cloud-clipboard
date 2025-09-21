import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import { useTranslation } from 'react-i18next';
import type { JoinRoomWithPasswordRequest, BrowserFingerprint } from '@cloud-clipboard/shared';

interface PasswordInputProps {
  roomKey: string;
  username: string;
  fingerprint: BrowserFingerprint;
  onJoinRoomWithPassword: (data: JoinRoomWithPasswordRequest) => void;
  onCancel: () => void;
  isConnecting: boolean;
}

export function PasswordInput({ 
  roomKey, 
  username, 
  fingerprint, 
  onJoinRoomWithPassword, 
  onCancel, 
  isConnecting 
}: PasswordInputProps): JSX.Element {
  const [password, setPassword] = useState('');
  const { toast } = useToast();
  const { t } = useTranslation();

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

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    
    if (!password.trim()) {
      toast({
        variant: 'destructive',
        title: t('toast.error'),
        description: t('passwordInput.errors.required'),
      });
      return;
    }

    const joinData: JoinRoomWithPasswordRequest = {
      type: 'join_room_with_password',
      roomKey,
      password: password.trim(),
      user: {
        name: username,
        deviceType: detectDeviceType(),
      },
      fingerprint,
    };

    onJoinRoomWithPassword(joinData);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {t('passwordInput.title')}
          </CardTitle>
          <CardDescription>
            {t('passwordInput.description', { roomKey })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t('passwordInput.password')}
              </label>
              <Input
                id="password"
                type="password"
                placeholder={t('passwordInput.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isConnecting}
                className="w-full"
                autoFocus
              />
            </div>
            
            <div className="flex gap-2">
              <Button 
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onCancel}
                disabled={isConnecting}
              >
                {t('passwordInput.cancelButton')}
              </Button>
              <Button 
                type="submit" 
                className="flex-1"
                disabled={isConnecting || !password.trim()}
              >
                {isConnecting ? t('passwordInput.joining') : t('passwordInput.joinButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}