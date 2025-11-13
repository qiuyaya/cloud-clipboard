import React from "react";
import { ShareList } from "../components/Share/ShareList";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SharePageProps {
  userId: string;
  onBack: () => void;
}

export const SharePage: React.FC<SharePageProps> = ({ userId, onBack }) => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("share.page.back")}
          </button>
          <h1 className="text-3xl font-bold text-foreground">{t("share.list.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("share.list.description")}</p>
        </div>

        {/* Share List */}
        <ShareList userId={userId} />
      </div>
    </div>
  );
};

export default SharePage;
