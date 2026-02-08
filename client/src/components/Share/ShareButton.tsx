import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "react-i18next";
import { getApiPath } from "@/utils/api";
import { Copy, Link as LinkIcon, Shield, ShieldOff, Calendar } from "lucide-react";

interface ShareButtonProps {
  fileId: string;
  fileName: string;
  onShareCreated?: (shareData: any) => void;
  onClose?: () => void;
}

export const ShareButton: React.FC<ShareButtonProps> = ({
  fileId,
  fileName,
  onShareCreated,
  onClose,
}) => {
  const [isLoading, setIsLoading] = React.useState(false);
  const [shareData, setShareData] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [enablePassword, setEnablePassword] = React.useState(false);
  const [expiresInDays, setExpiresInDays] = React.useState<string>("7");
  const [copiedItem, setCopiedItem] = React.useState<"url" | "password" | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  const calculateExpirationDays = (expiresAt: string) => {
    const expiresDate = new Date(expiresAt);
    const now = new Date();
    const diffTime = expiresDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const handleCreateShare = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const requestBody: any = {
        fileId,
        expiresInDays: parseInt(expiresInDays),
      };

      // Only add password field if user wants to enable it
      if (enablePassword) {
        requestBody.password = "auto-generate"; // Let server generate password
      }

      const response = await fetch(getApiPath("/api/share"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to create share link");
      }

      setShareData(data.data);
      onShareCreated?.(data.data);
    } catch (err: any) {
      setError(err.message);
      toast({
        title: t("share.modal.toast.createFailed"),
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (type: "url" | "password", text?: string) => {
    try {
      const content = type === "url" ? shareData?.url : text;
      if (!content) return;

      await navigator.clipboard.writeText(content);
      setCopiedItem(type);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (err) {
      toast({
        title: t("toast.failedToCopy"),
        description: t("toast.failedToCopyDesc"),
        variant: "destructive",
      });
    }
  };

  if (shareData) {
    // Calculate expiration days from expiresAt date
    const diffDays = calculateExpirationDays(shareData.expiresAt);
    return (
      <Card className="w-full border-0 shadow-2xl bg-gradient-to-br from-background to-muted/20">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <LinkIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">{t("share.modal.createdTitle")}</CardTitle>
              <CardDescription className="mt-1">{fileName}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg border border-border">
            <Label className="text-xs text-muted-foreground mb-2 block">
              {t("share.modal.urlLabel")}
            </Label>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono flex-1 break-all bg-background p-2 rounded border">
                {shareData.url}
              </code>
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard("url")}
                  className="shrink-0"
                  title={t("share.modal.actions.copy")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {copiedItem === "url" && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                    <span className="text-popover-foreground">{t("room.copied")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {shareData.hasPassword && (
            <div className="bg-primary/10 p-4 rounded-lg border border-primary/20">
              <Label className="text-xs text-primary mb-2 block font-semibold">
                {t("share.modal.password.label")}
              </Label>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono flex-1 break-all bg-background p-2 rounded border border-primary/30">
                  {shareData.password}
                </code>
                <div className="relative">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard("password", shareData.password)}
                    className="shrink-0"
                    title={t("share.modal.password.copy")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {copiedItem === "password" && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                      <span className="text-popover-foreground">{t("room.copied")}</span>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t("share.modal.password.generatedHint")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{t("share.modal.expires.label", { days: diffDays })}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {shareData.hasPassword ? (
                <>
                  <Shield className="h-4 w-4 text-primary" />
                  <span>{t("share.modal.status.protected")}</span>
                </>
              ) : (
                <>
                  <ShieldOff className="h-4 w-4" />
                  <span>{t("share.modal.status.public")}</span>
                </>
              )}
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          <Button
            variant="ghost"
            onClick={() => setShareData(null)}
            className="w-full text-muted-foreground"
          >
            {t("share.modal.actions.createAnother")}
          </Button>
          {onClose && (
            <Button variant="outline" onClick={onClose} className="w-full">
              {t("pwa.close")}
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full border-0 shadow-2xl bg-gradient-to-br from-background to-muted/20">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <LinkIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-xl">{t("share.modal.title")}</CardTitle>
            <CardDescription className="mt-1">{fileName}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="bg-primary/5 p-4 rounded-lg border border-primary/10">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-medium mb-1">{t("share.modal.password.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("share.modal.password.description")}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t("share.modal.expiresInDays.label")}
          </Label>
          <Select value={expiresInDays} onValueChange={setExpiresInDays}>
            <SelectTrigger>
              <SelectValue placeholder={t("share.modal.expiresInDays.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t("share.modal.expiresInDays.1day")}</SelectItem>
              <SelectItem value="3">{t("share.modal.expiresInDays.3days")}</SelectItem>
              <SelectItem value="7">{t("share.modal.expiresInDays.7days")}</SelectItem>
              <SelectItem value="15">{t("share.modal.expiresInDays.15days")}</SelectItem>
              <SelectItem value="30">{t("share.modal.expiresInDays.30days")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("share.modal.expiresInDays.description")}
          </p>
        </div>

        <div className="flex items-center space-x-3 bg-muted/30 p-4 rounded-lg border">
          <Checkbox
            id="enable-password"
            checked={enablePassword}
            onCheckedChange={(checked) => setEnablePassword(!!checked)}
          />
          <Label htmlFor="enable-password" className="text-sm font-medium cursor-pointer">
            {t("share.modal.password.enableLabel")}
          </Label>
          {enablePassword && (
            <span className="text-xs text-muted-foreground">
              {t("share.modal.password.autoGenerateHint")}
            </span>
          )}
        </div>

        <Button
          onClick={handleCreateShare}
          disabled={isLoading}
          className="w-full h-11 text-base"
          size="lg"
        >
          {isLoading ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              {t("share.modal.creating")}
            </>
          ) : (
            <>
              <LinkIcon className="h-4 w-4 mr-2" />
              {t("share.modal.createButton")}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
