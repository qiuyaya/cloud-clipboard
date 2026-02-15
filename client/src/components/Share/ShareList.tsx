import React, { useState, useEffect } from "react";
import { shareApi } from "../../services/shareApi";
import { formatFileSize, formatTimestamp, formatExpiryTime } from "@cloud-clipboard/shared";
import { Clock, Download, Lock, Unlock, Trash2, Eye, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/useToast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
  hasPassword: boolean;
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
      setShares(response.shares);
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
      // Auto-hide tooltip after 2 seconds
      setTimeout(() => setCopiedShareId(null), 2000);
    } catch (err) {
      // Fallback to toast if clipboard API fails
      toast({
        title: t("share.list.toast.copySuccess"),
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400">
            {t("share.list.status.active")}
          </span>
        );
      case "expired":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-400">
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
      <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded mb-4">
        {error}
        <button onClick={loadShares} className="ml-2 underline hover:no-underline">
          {t("share.list.toast.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "expired"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              filter === status
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t(`share.list.filters.${status}`)}
          </button>
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
              className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-foreground truncate">
                      {share.originalFilename}
                    </h3>
                    {share.hasPassword ? (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Unlock className="h-4 w-4 text-muted-foreground" />
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

                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => copyToClipboard(share.url, share.shareId)}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-accent rounded transition-colors relative"
                    title={t("share.list.actions.copy")}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedShareId === share.shareId && (
                      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 z-50">
                        <span className="text-popover-foreground">{t("room.copied")}</span>
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => handleViewLogs(share)}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-accent rounded transition-colors"
                    title={t("share.list.actions.logs")}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteClick(share)}
                    className="p-2 text-muted-foreground hover:text-destructive hover:bg-accent rounded transition-colors"
                    title={t("share.list.actions.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 p-2 bg-muted rounded text-xs font-mono break-all text-muted-foreground">
                {share.url}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Access Logs Modal */}
      {showLogs && selectedShare && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-border">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                  {t("share.list.logs.title", { filename: selectedShare.originalFilename })}
                </h2>
                <button
                  onClick={() => setShowLogs(false)}
                  className="text-muted-foreground hover:text-foreground text-2xl transition-colors"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {accessLogs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  {t("share.list.logs.empty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {accessLogs.map((log, index) => (
                    <div key={index} className="bg-muted rounded p-3 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`font-medium ${
                            log.success ? "text-green-600 dark:text-green-400" : "text-destructive"
                          }`}
                        >
                          {log.success ? "✓ Success" : "✗ Failed"}
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
                          <p className="text-destructive">Error: {log.errorCode}</p>
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
          </div>
        </div>
      )}

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
