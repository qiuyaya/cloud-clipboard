import { useState, useEffect } from "react";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "react-i18next";
import type { User } from "@cloud-clipboard/shared";

interface UseActivityMonitorProps {
  currentUser: User | null;
  onLeaveRoom: () => void;
}

export const useActivityMonitor = ({ currentUser, onLeaveRoom }: UseActivityMonitorProps) => {
  const [lastActivity, setLastActivity] = useState(Date.now());
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const updateActivity = () => setLastActivity(Date.now());

    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    events.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, updateActivity);
      });
    };
  }, []);

  useEffect(() => {
    const checkInactivity = () => {
      const twoHours = 2 * 60 * 60 * 1000;
      if (currentUser && Date.now() - lastActivity > twoHours) {
        onLeaveRoom();
        toast({
          title: t("toast.autoLogout"),
          description: t("toast.autoLogoutDesc"),
        });
      }
    };

    const interval = setInterval(checkInactivity, 60000);
    return () => clearInterval(interval);
  }, [currentUser, lastActivity, onLeaveRoom, toast, t]);

  return { lastActivity };
};
