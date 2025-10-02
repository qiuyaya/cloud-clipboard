import React, { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

export function PWAUpdatePrompt(): JSX.Element | null {
  const { t } = useTranslation();
  const [showReload, setShowReload] = useState(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: ServiceWorkerRegistration | undefined) {
      console.log("SW Registered:", r);
    },
    onRegisterError(error: Error) {
      console.error("SW registration error:", error);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      console.log("App ready to work offline");
    }
  }, [offlineReady]);

  useEffect(() => {
    if (needRefresh) {
      setShowReload(true);
    }
  }, [needRefresh]);

  const handleUpdate = () => {
    updateServiceWorker(true);
    setShowReload(false);
  };

  const handleClose = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setShowReload(false);
  };

  if (!showReload && !offlineReady) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 animate-in slide-in-from-top-5">
      <Card className="shadow-lg border-2 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              {showReload ? (
                <>
                  <h3 className="font-semibold text-sm mb-1">{t("pwa.updateTitle")}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("pwa.updateDescription")}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={handleUpdate} size="sm" className="flex-1">
                      {t("pwa.reload")}
                    </Button>
                    <Button onClick={handleClose} variant="outline" size="sm">
                      {t("pwa.later")}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="font-semibold text-sm mb-1">{t("pwa.offlineTitle")}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("pwa.offlineDescription")}
                  </p>
                  <Button onClick={handleClose} variant="outline" size="sm" className="w-full">
                    {t("pwa.close")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
