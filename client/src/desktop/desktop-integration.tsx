import React, { createContext, useContext, useEffect, useState } from "react";
import { DesktopAPI, AppConfig } from "./desktop-api";
import { ClipboardMonitor } from "./clipboard-monitor";

interface DesktopContextType {
  config: AppConfig | null;
  updateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
  clipboardMonitor: ClipboardMonitor | null;
  isDesktop: boolean;
  showNotification: (title: string, body: string) => Promise<void>;
}

const DesktopContext = createContext<DesktopContextType | null>(null);

export const useDesktop = () => {
  const context = useContext(DesktopContext);
  if (!context) {
    throw new Error("useDesktop must be used within a DesktopProvider");
  }
  return context;
};

interface DesktopProviderProps {
  children: React.ReactNode;
  onClipboardChange?: (text: string) => void;
}

export const DesktopProvider: React.FC<DesktopProviderProps> = ({
  children,
  onClipboardChange,
}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [clipboardMonitor, setClipboardMonitor] = useState<ClipboardMonitor | null>(null);
  const isDesktop = DesktopAPI.isDesktop();

  useEffect(() => {
    if (isDesktop) {
      // Load initial config
      DesktopAPI.getConfig().then(setConfig).catch(console.error);

      // Initialize clipboard monitor
      const monitor = new ClipboardMonitor(onClipboardChange);
      setClipboardMonitor(monitor);

      return () => {
        monitor.stop();
      };
    }
  }, [isDesktop, onClipboardChange]);

  useEffect(() => {
    if (config && clipboardMonitor && config.auto_clipboard) {
      clipboardMonitor.start(config.sync_interval);
    } else if (clipboardMonitor) {
      clipboardMonitor.stop();
    }
  }, [config, clipboardMonitor]);

  const updateConfig = async (newConfig: Partial<AppConfig>) => {
    if (!config) return;

    const updatedConfig = { ...config, ...newConfig };
    await DesktopAPI.setConfig(updatedConfig);
    setConfig(updatedConfig);
  };

  const showNotification = async (title: string, body: string) => {
    if (isDesktop) {
      await DesktopAPI.showNotification(title, body);
    } else {
      // Fallback for web
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    }
  };

  const contextValue: DesktopContextType = {
    config,
    updateConfig,
    clipboardMonitor,
    isDesktop,
    showNotification,
  };

  return <DesktopContext.Provider value={contextValue}>{children}</DesktopContext.Provider>;
};
