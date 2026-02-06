import { useTranslation } from "react-i18next";

export function Version(): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="text-center text-xs text-muted-foreground">
      {t("version.label", { version: __APP_VERSION__ })}
    </div>
  );
}
