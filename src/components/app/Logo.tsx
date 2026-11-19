import { useTranslation } from "react-i18next";
export function Logo({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold">Dialogue Society</div>
        <div className="text-xs opacity-80">{t("common.hubName")}</div>
      </div>
    </div>
  );
}
