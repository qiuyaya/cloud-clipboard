import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface ConnectionStatusProps {
  isConnected: boolean;
  isConnecting?: boolean;
  className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  isConnected,
  isConnecting = false,
  className = "",
}) => {
  const { t } = useTranslation();

  const getStatusConfig = () => {
    if (isConnecting) {
      return {
        text: t("connection.connecting"),
        bgColor: "bg-yellow-500",
        hoverColor: "hover:bg-yellow-600",
      };
    }

    if (isConnected) {
      return {
        text: t("connection.connected"),
        bgColor: "bg-green-500",
        hoverColor: "hover:bg-green-600",
      };
    }

    return {
      text: t("connection.disconnected"),
      bgColor: "bg-red-500",
      hoverColor: "hover:bg-red-600",
    };
  };

  const config = getStatusConfig();

  return (
    <div className={cn("relative group", className)}>
      {/* Status dot */}
      <div
        className={cn(
          "w-3 h-3 rounded-full transition-colors duration-200",
          config.bgColor,
          config.hoverColor,
        )}
      />

      {/* Tooltip on hover */}
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 top-full mt-2",
          "px-2 py-1 rounded-md",
          "bg-gray-800 dark:bg-gray-200",
          "text-white dark:text-gray-900",
          "text-xs font-medium whitespace-nowrap",
          "opacity-0 group-hover:opacity-100 pointer-events-none",
          "transition-opacity duration-200",
          "z-50",
        )}
      >
        {config.text}
        {/* Tooltip arrow */}
        <div
          className={cn(
            "absolute -top-1 left-1/2 -translate-x-1/2",
            "w-0 h-0 border-l-4 border-r-4 border-b-4",
            "border-gray-800 dark:border-gray-200",
            "border-l-transparent border-r-transparent",
          )}
        />
      </div>
    </div>
  );
};
