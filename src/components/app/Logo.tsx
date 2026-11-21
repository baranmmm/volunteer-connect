import { useTranslation } from "react-i18next";

// The glow is baked into the artwork, so the image itself carries the halo.
// Negative margins let that glow bleed into the navy while the text stays put.
const MARK_SIZES = {
  md: "-m-2.5 h-16 w-16 max-w-none",
  sm: "-m-1.5 h-10 w-10 max-w-none",
} as const;

export function Logo({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: keyof typeof MARK_SIZES;
}) {
  const { t } = useTranslation();

  const mobile = size === "sm";

  return (
    <div className={`inline-flex min-w-0 items-center gap-3 ${className}`}>
      <img
        src="/brand/ds-logo-glow.png"
        alt="Dialogue Society"
        className={`shrink-0 ${MARK_SIZES[size]}`}
      />
      <div className={`min-w-0 flex-1 leading-tight ${mobile ? "block" : "hidden lg:block"}`}>
        <div className={`truncate font-semibold ${mobile ? "text-[15px] text-foreground" : "text-base text-sidebar-foreground"}`}>Dialogue Society</div>
        <div className={`truncate text-xs ${mobile ? "mt-0.5 text-foreground/70" : "mt-1 text-sidebar-foreground/70"}`}>{t("common.hubName")}</div>
      </div>
    </div>
  );
}
