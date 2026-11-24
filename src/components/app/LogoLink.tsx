import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

/**
 * The logo and title as the home link: /dashboard when signed in, / when signed out. Test id: logo-home-link
 * (data-target). Keyboard accessible like any link; its name is "Go to home".
 */
export function LogoLink({
  className,
  ...logo
}: { className?: string } & Omit<Parameters<typeof Logo>[0], "className">) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const to = session ? "/dashboard" : "/";
  return (
    <Link
      to={to}
      data-testid="logo-home-link"
      data-target={to}
      aria-label={t("common.goHomeLabel")}
      className={cn(
        "inline-flex min-h-11 min-w-0 max-w-full items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Logo {...logo} className="w-full" />
    </Link>
  );
}
