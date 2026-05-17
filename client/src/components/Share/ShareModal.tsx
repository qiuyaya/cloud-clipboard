import React from "react";
import { ShareButton } from "./ShareButton";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, fileId, fileName }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in-0 duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md mx-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200">
        <ShareButton
          fileId={fileId}
          fileName={fileName}
          onShareCreated={() => {}}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
