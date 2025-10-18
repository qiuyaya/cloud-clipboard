import React from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

interface MobileNavProps {
  onOpenSidebar: () => void;
}

export function MobileNav({ onOpenSidebar }: MobileNavProps): JSX.Element {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onOpenSidebar}
      className="lg:hidden h-12 w-12"
      aria-label="打开侧边栏"
    >
      <Menu className="h-6 w-6" />
    </Button>
  );
}

