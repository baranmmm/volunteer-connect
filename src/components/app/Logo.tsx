import { useTranslation } from "react-i18next";

export function Logo({ className = "" }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <div className="logo-tile flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px]">
        <img
          src="/ds-mark.svg"
          alt="Dialogue Society"
          className="logo-mark-shine relative z-[1] h-8 w-auto"
        />
      </div>
      <div className="hidden min-w-0 leading-tight lg:block">
        <div className="text-base font-semibold text-sidebar-foreground">Dialogue Society</div>
        <div className="mt-1 text-xs text-sidebar-foreground/70">{t("common.hubName")}</div>
      </div>
    </div>
  );
}
