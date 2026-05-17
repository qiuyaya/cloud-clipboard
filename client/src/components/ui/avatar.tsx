import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  color?: string;
  seed?: string;
}

// Deterministic color generation based on string hash
export function stringToHslColor(str: string, s: number, l: number): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function getInitials(name: string): string {
  if (!name) return "?";
  // For Chinese names, take first character; for others, take up to 2 chars
  const isCJK = /[\u4e00-\u9fff]/.test(name);
  if (isCJK) return name.charAt(0).toUpperCase();
  const parts = name.split(/\s+/);
  if (parts.length > 1) {
    return (
      (parts[0] as string).charAt(0) + (parts[parts.length - 1] as string).charAt(0)
    ).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, name, color, seed, ...props }, ref) => {
    const bgColor = color ?? stringToHslColor(seed || name, 65, 45);
    const textColor = "#ffffff";

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full items-center justify-center text-xs font-bold select-none",
          className,
        )}
        style={{ backgroundColor: bgColor, color: textColor }}
        {...props}
      >
        {getInitials(name)}
      </div>
    );
  },
);
Avatar.displayName = "Avatar";

export { Avatar };
