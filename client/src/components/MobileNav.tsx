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
      className="lg:hidden h-10 w-10"
      aria-label={t("room.openSidebar")}
    >
      <Menu className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}
