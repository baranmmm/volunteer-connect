import { useTranslation } from "react-i18next";

export function Logo({ className = "" }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div className={`inline-flex items-center gap-3 rounded-2xl bg-card p-3 text-card-foreground ${className}`}>
      <img
        src="/icons/ds-icon-270.png"
        alt="Dialogue Society"
        className="h-10 w-10 shrink-0 lg:hidden"
      />
      <div className="hidden min-w-0 lg:block">
        <img
          src="/ds-logo.svg"
          alt="Dialogue Society"
          className="h-14 w-auto max-w-full object-contain object-left"
        />
        <div className="mt-1 text-xs font-medium text-muted-foreground">{t("common.hubName")}</div>
      </div>
      <div className="text-sm font-semibold lg:hidden">{t("common.hubName")}</div>
    </div>
  );
}
