import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { PasswordInput } from "@/components/PasswordInput";
import { useTranslation } from "react-i18next";
import type {
  JoinRoomRequest,
  JoinRoomWithPasswordRequest,
  BrowserFingerprint,
} from "@cloud-clipboard/shared";
import {
  RoomKeySchema,
  generateBrowserFingerprint,
  generateRoomKey,
  generateDefaultUsername,
} from "@cloud-clipboard/shared";

interface RoomJoinProps {
  onJoinRoom: (data: JoinRoomRequest) => void;
  onJoinRoomWithPassword: (data: JoinRoomWithPasswordRequest) => void;
  isConnecting: boolean;
  showPasswordInput?: boolean;
  onCancelPassword?: () => void;
}

export function RoomJoin({
  onJoinRoom,
  onJoinRoomWithPassword,
  isConnecting,
  showPasswordInput,
  onCancelPassword,
}: RoomJoinProps): JSX.Element {
  const [roomKey, setRoomKey] = useState("");
  const [username, setUsername] = useState("");
  const [urlPassword, setUrlPassword] = useState<string | null>(null);
  const [cachedFingerprint, setCachedFingerprint] = useState<BrowserFingerprint | null>(null);
  const [isFromShareLink, setIsFromShareLink] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  // Generate and cache fingerprint on component load
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cloudClipboard_fingerprint");
      if (saved) {
        // Use cached fingerprint data if available
        const parsed = JSON.parse(saved);
        // Validate that we have a proper fingerprint object with required fields
        if (parsed && typeof parsed === "object" && parsed.hash && parsed.userAgent !== undefined) {
          setCachedFingerprint(parsed);
          return;
        }
      }

      // Generate new fingerprint and cache it (also handles invalid cached data)
      const fingerprint = generateBrowserFingerprint();
      localStorage.setItem("cloudClipboard_fingerprint", JSON.stringify(fingerprint));
      setCachedFingerprint(fingerprint);
    } catch {
      // Fallback: generate new fingerprint and clear bad cache
      localStorage.removeItem("cloudClipboard_fingerprint");
      const fingerprint = generateBrowserFingerprint();
      localStorage.setItem("cloudClipboard_fingerprint", JSON.stringify(fingerprint));
      setCachedFingerprint(fingerprint);
    }
  }, []);

  // Check for room key and password in URL parameters and auto-join if found
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomKeyFromUrl = urlParams.get("room");
    const passwordFromUrl = urlParams.get("password");

    if (roomKeyFromUrl) {
      setRoomKey(roomKeyFromUrl);
      setIsFromShareLink(true);

      if (passwordFromUrl) {
        setUrlPassword(passwordFromUrl);
      }

      // Clear the URL parameters to avoid confusion
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  // Auto-join room when we have all necessary data from share link
  useEffect(() => {
    if (
      roomKey &&
      cachedFingerprint &&
      roomKey.trim().length > 0 &&
      !isConnecting &&
      isFromShareLink
    ) {
      // This is a share link, auto-join the room

      // Generate default username if not provided
      const finalUsername = username.trim() || generateDefaultUsername();

      try {
        const validatedKey = RoomKeySchema.parse(roomKey.trim());

        // If we have a password from URL, join with password directly
        if (urlPassword) {
          const joinWithPasswordData: JoinRoomWithPasswordRequest = {
            type: "join_room_with_password",
            roomKey: validatedKey,
            password: urlPassword,
            user: {
              name: finalUsername,
              deviceType: detectDeviceType(),
            },
            fingerprint: cachedFingerprint,
          };
          onJoinRoomWithPassword(joinWithPasswordData);
        } else {
          const joinData: JoinRoomRequest = {
            type: "join_room",
            roomKey: validatedKey,
            user: {
              name: finalUsername,
              deviceType: detectDeviceType(),
            },
            fingerprint: cachedFingerprint,
          };
          onJoinRoom(joinData);
        }

        // Mark that we've handled the share link
        setIsFromShareLink(false);
      } catch (error) {
        // If validation fails, let user manually correct and join
        console.warn("Auto-join failed due to validation error:", error);
      }
    }
  }, [
    roomKey,
    cachedFingerprint,
    username,
    urlPassword,
    isConnecting,
    isFromShareLink,
    onJoinRoom,
    onJoinRoomWithPassword,
  ]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();

    if (!roomKey.trim()) {
      toast({
        variant: "destructive",
        title: t("toast.error"),
        description: t("roomJoin.errors.roomKeyRequired"),
      });
      return;
    }

    if (!cachedFingerprint) {
      toast({
        variant: "destructive",
        title: t("toast.error"),
        description: t("roomJoin.errors.fingerprintNotReady"),
      });
      return;
    }

    try {
      const validatedKey = RoomKeySchema.parse(roomKey.trim());

      // Generate default username if not provided
      const finalUsername = username.trim() || generateDefaultUsername();

      // If we have a password from URL, join with password directly
      if (urlPassword) {
        const joinWithPasswordData: JoinRoomWithPasswordRequest = {
          type: "join_room_with_password",
          roomKey: validatedKey,
          password: urlPassword,
          user: {
            name: finalUsername,
            deviceType: detectDeviceType(),
          },
          fingerprint: cachedFingerprint,
        };
        onJoinRoomWithPassword(joinWithPasswordData);
      } else {
        const joinData: JoinRoomRequest = {
          type: "join_room",
          roomKey: validatedKey,
          user: {
            name: finalUsername,
            deviceType: detectDeviceType(),
          },
          fingerprint: cachedFingerprint, // Use cached fingerprint instead of generating new one
        };

        onJoinRoom(joinData);
      }
    } catch (error) {
      let errorMessage = t("roomJoin.errors.invalidKey");

      // Handle Zod validation errors specifically and use internationalized messages
      if (error && typeof error === "object" && "issues" in error) {
        // This is a Zod error with issues array
        const zodError = error as any;
        if (zodError.issues && zodError.issues.length > 0) {
          const issue = zodError.issues[0];
          // Map specific error messages to internationalized versions
          if (issue.message.includes("must be at least 6 characters")) {
            errorMessage = t("roomJoin.errors.tooShort");
          } else if (issue.message.includes("must contain both letters and numbers")) {
            errorMessage = t("roomJoin.errors.needsBoth");
          } else if (
            issue.message.includes("can only contain letters, numbers, underscores, and hyphens")
          ) {
            errorMessage = t("roomJoin.errors.invalidChars");
          } else {
            errorMessage = issue.message; // Fallback to original message
          }
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      toast({
        variant: "destructive",
        title: t("toast.error"),
        description: errorMessage,
      });
    }
  };

  const detectDeviceType = (): "mobile" | "desktop" | "tablet" | "unknown" => {
    const userAgent = navigator.userAgent.toLowerCase();

    if (/mobile|android|iphone|phone/.test(userAgent)) {
      return "mobile";
    }

    if (/tablet|ipad/.test(userAgent)) {
      return "tablet";
    }

    if (/desktop|windows|mac|linux/.test(userAgent)) {
      return "desktop";
    }

    return "unknown";
  };

  const handleQuickCreate = () => {
    if (!cachedFingerprint) {
      toast({
        variant: "destructive",
        title: t("toast.error"),
        description: t("roomJoin.errors.fingerprintNotReady"),
      });
      return;
    }

    const newRoomKey = generateRoomKey();

    // Generate default username if not provided
    const finalUsername = username.trim() || generateDefaultUsername();

    const joinData: JoinRoomRequest = {
      type: "join_room",
      roomKey: newRoomKey,
      user: {
        name: finalUsername,
        deviceType: detectDeviceType(),
      },
      fingerprint: cachedFingerprint,
    };

    onJoinRoom(joinData);
  };

  // Show password input if needed
  if (showPasswordInput && roomKey && username && cachedFingerprint) {
    return (
      <PasswordInput
        roomKey={roomKey}
        username={username}
        fingerprint={cachedFingerprint}
        onJoinRoomWithPassword={onJoinRoomWithPassword}
        onCancel={onCancelPassword || (() => {})}
        isConnecting={isConnecting}
      />
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 safe-area-inset">
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md mx-4 mt-8">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {t("roomJoin.title")}
          </CardTitle>
          <CardDescription>{t("roomJoin.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="roomKey" className="text-sm font-medium">
                {t("roomJoin.roomKey")}
              </label>
              <Input
                id="roomKey"
                type="text"
                placeholder={t("roomJoin.roomKeyPlaceholder")}
                value={roomKey}
                onChange={(e) => setRoomKey(e.target.value.slice(0, 50))}
                disabled={isConnecting}
                className="w-full"
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">{t("roomJoin.hints.roomKeyFormat")}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                {t("roomJoin.username")}
              </label>
              <Input
                id="username"
                type="text"
                placeholder={t("roomJoin.usernamePlaceholder")}
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.replace(/[^a-zA-Z0-9\s._-]/g, "").slice(0, 50))
                }
                disabled={isConnecting}
                className="w-full"
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">{t("roomJoin.hints.usernameFormat")}</p>
            </div>

            <Button type="submit" className="w-full mobile-touch" size="mobile" disabled={isConnecting || !roomKey.trim()}>
              {isConnecting ? t("roomJoin.joining") : t("roomJoin.joinButton")}
            </Button>
          </form>

          <div className="mt-4 flex items-center">
            <div className="flex-1 border-t border-muted"></div>
            <span className="px-4 text-xs text-muted-foreground">{t("roomJoin.or")}</span>
            <div className="flex-1 border-t border-muted"></div>
          </div>

          <Button
            variant="outline"
            className="w-full mt-4 mobile-touch"
            size="mobile"
            onClick={handleQuickCreate}
            disabled={isConnecting}
          >
            {t("roomJoin.quickCreateButton")}
          </Button>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">{t("roomJoin.shareHint")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
