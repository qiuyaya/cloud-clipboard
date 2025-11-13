import React from "react";
import { ShareButton } from "./ShareButton";
import { X } from "lucide-react";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, fileId, fileName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in-0 duration-200">
      <div className="relative w-full max-w-md mx-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200">
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted/50 z-10"
          aria-label="Close share modal"
        >
          <X className="h-6 w-6" />
        </button>

        <ShareButton
          fileId={fileId}
          fileName={fileName}
          onShareCreated={(shareData) => {
            console.log("Share created:", shareData);
          }}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
