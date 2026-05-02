import React from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";

interface MobileNavProps {
  onOpenSidebar: () => void;
}

export function MobileNav({ onOpenSidebar }: MobileNavProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onOpenSidebar}
      className="lg:hidden h-12 w-12"
      aria-label={t("room.openSidebar")}
    >
      <Menu className="h-6 w-6" aria-hidden="true" />
    </Button>
  );
}
