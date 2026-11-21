import { useTranslation } from "react-i18next";

// The glow is baked into the artwork, so the image itself carries the halo.
// Negative margins let that glow bleed into the navy while the text stays put.
const MARK_SIZES = {
  md: "-m-2.5 h-16 w-16 max-w-none",
  sm: "-m-2 h-12 w-12 max-w-none",
} as const;

export function Logo({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: keyof typeof MARK_SIZES;
}) {
  const { t } = useTranslation();

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <img
        src="/brand/ds-logo-glow.png"
        alt="Dialogue Society"
        className={`shrink-0 ${MARK_SIZES[size]}`}
      />
      <div className="hidden min-w-0 leading-tight lg:block">
        <div className="text-base font-semibold text-sidebar-foreground">Dialogue Society</div>
        <div className="mt-1 text-xs text-sidebar-foreground/70">{t("common.hubName")}</div>
      </div>
    </div>
  );
}
