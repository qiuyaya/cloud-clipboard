import React, { useState, useEffect } from "react";
import { shareApi } from "../../services/shareApi";
import { formatFileSize, formatTimestamp, formatExpiryTime } from "@cloud-clipboard/shared";
import { Clock, Download, Lock, Unlock, Trash2, Eye, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ShareListProps {
  userId: string;
}

interface ShareItem {
  shareId: string;
  originalFilename: string;
  fileSize: number;
  createdAt: string;
  expiresAt: string;
  status: "active" | "expired";
  accessCount: number;
  hasAccessCode: boolean;
  url: string;
}

export const ShareList: React.FC<ShareListProps> = ({ userId }) => {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "expired">("all");
  const [selectedShare, setSelectedShare] = useState<ShareItem | null>(null);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shareToDelete, setShareToDelete] = useState<ShareItem | null>(null);
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    loadShares();
  }, [userId, filter]);

  const loadShares = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await shareApi.listShares({
        status: filter,
        limit: 50,
        offset: 0,
      });
      // Map API hasPassword to hasAccessCode
      setShares(
        response.shares.map((s) => ({
          ...s,
          hasAccessCode: s.hasPassword,
        })),
      );
    } catch (err: any) {
      setError(err.message || t("share.list.toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (share: ShareItem) => {
    setShareToDelete(share);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!shareToDelete) return;

    try {
      await shareApi.permanentDeleteShare(shareToDelete.shareId);
      // Clean up stored access code
      try {
        localStorage.removeItem(`share_access_code_${shareToDelete.shareId}`);
      } catch {
        // non-critical
      }
      await loadShares();
    } catch (err: any) {
      toast({
        title: t("share.list.toast.deleteFailed"),
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setShareToDelete(null);
    }
  };

  const handleViewLogs = async (share: ShareItem) => {
    setSelectedShare(share);
    try {
      const logs = await shareApi.getAccessLogs(share.shareId);
      setAccessLogs(logs.logs);
      setShowLogs(true);
    } catch (err: any) {
      toast({
        title: t("share.list.toast.logsLoadFailed"),
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = async (text: string, shareId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedShareId(shareId);
      setTimeout(() => setCopiedShareId(null), 2000);
    } catch (err) {
      toast({
        title: t("share.list.toast.copySuccess"),
      });
    }
  };

  const getShareUrlWithAccessCode = (share: ShareItem): string => {
    if (!share.hasAccessCode) return share.url;
    try {
      const accessCode = localStorage.getItem(`share_access_code_${share.shareId}`);
      if (accessCode) {
        return `${share.url}?code=${encodeURIComponent(accessCode)}`;
      }
    } catch {
      // localStorage may be unavailable
    }
    return share.url;
  };

  const isAccessCodeAvailable = (share: ShareItem): boolean => {
    if (!share.hasAccessCode) return true;
    try {
      return !!localStorage.getItem(`share_access_code_${share.shareId}`);
    } catch {
      return false;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400">
            {t("share.list.status.active")}
          </span>
        );
      case "expired":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-400">
            {t("share.list.status.expired")}
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-muted-foreground">{t("share.list.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
        <span>{error}</span>
        <Button variant="ghost" size="sm" onClick={loadShares}>
          {t("share.list.toast.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "expired"] as const).map((status) => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(status)}
          >
            {t(`share.list.filters.${status}`)}
          </Button>
        ))}
      </div>

      {/* Share List */}
      {shares.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">{t("share.list.empty")}</div>
      ) : (
        <div className="space-y-3">
          {shares.map((share) => (
            <div
              key={share.shareId}
              className="bg-card rounded-xl border border-border p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-semibold text-foreground truncate">
                      {share.originalFilename}
                    </h3>
                    {share.hasAccessCode ? (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    {getStatusBadge(share.status)}
                  </div>

                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>
                      {t("share.list.fields.created")}:{" "}
                      {formatTimestamp(new Date(share.createdAt), i18n.language)}
                    </p>
                    <p>
                      {t("share.list.fields.expires")}:{" "}
                      {formatExpiryTime(new Date(share.expiresAt), i18n.language)}
                    </p>
                    <p className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      {share.accessCount} {t("share.list.fields.downloads")}
                    </p>
                    {share.fileSize > 0 && (
                      <p>
                        {t("share.list.fields.size")}: {formatFileSize(share.fileSize)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 relative"
                    onClick={() => copyToClipboard(getShareUrlWithAccessCode(share), share.shareId)}
                    title={t("share.list.actions.copy")}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedShareId === share.shareId && (
                      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-primary font-medium whitespace-nowrap animate-in fade-in zoom-in duration-200">
                        {t("room.copied")}
                      </span>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleViewLogs(share)}
                    title={t("share.list.actions.logs")}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteClick(share)}
                    title={t("share.list.actions.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 p-2 bg-muted rounded-lg text-xs font-mono break-all text-muted-foreground">
                {getShareUrlWithAccessCode(share)}
              </div>
              {share.hasAccessCode && !isAccessCodeAvailable(share) && (
                <p className="mt-1 text-xs text-muted-foreground italic">
                  {t("share.list.accessCodeUnavailable")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Access Logs Dialog */}
      <Dialog open={showLogs} onOpenChange={setShowLogs}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b border-border">
            <DialogTitle className="text-lg">
              {selectedShare &&
                t("share.list.logs.title", { filename: selectedShare.originalFilename })}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("share.list.logs.title", { filename: selectedShare?.originalFilename || "" })}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 p-4">
            {accessLogs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t("share.list.logs.empty")}</p>
            ) : (
              <div className="space-y-2">
                {accessLogs.map((log, index) => (
                  <div key={index} className="bg-muted rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`font-medium ${
                          log.success ? "text-green-600 dark:text-green-400" : "text-destructive"
                        }`}
                      >
                        {log.success ? t("share.list.logs.success") : t("share.list.logs.failed")}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-muted-foreground space-y-1">
                      <p>
                        {t("share.list.logs.fields.ip")}: {log.ipAddress}
                      </p>
                      {log.userAgent && (
                        <p>
                          {t("share.list.logs.fields.userAgent")}: {log.userAgent}
                        </p>
                      )}
                      {log.errorCode && (
                        <p className="text-destructive">
                          {t("share.list.logs.error", { code: log.errorCode })}
                        </p>
                      )}
                      {log.bytesTransferred > 0 && (
                        <p>
                          {t("share.list.logs.fields.bytesTransferred")}:{" "}
                          {formatFileSize(log.bytesTransferred)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("share.list.confirm.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {shareToDelete && t("share.list.confirm.deleteMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("share.list.confirm.cancelButton")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("share.list.confirm.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
