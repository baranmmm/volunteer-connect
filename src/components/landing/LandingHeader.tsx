import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/** Logo, Events, Sign in and Join (sign-up form). */
export function LandingHeader() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-40 border-b border-ds-border/70 bg-ds-bg/90 backdrop-blur supports-[backdrop-filter]:bg-ds-bg/75">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <Link
          to="/"
          aria-label={t("landing.nav.home")}
          className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-md"
        >
          <img
            src="/brand/ds-logo-glow.svg"
            alt=""
            width={44}
            height={44}
            className="-m-1 h-11 w-11 shrink-0"
          />
          <span className="truncate text-base font-semibold tracking-tight text-ds-logo sm:text-lg">
            Dialogue Society
          </span>
        </Link>
        <nav
          aria-label={t("landing.nav.label")}
          className="flex shrink-0 items-center gap-1 text-sm font-medium sm:gap-2"
        >
          <Link
            to="/events"
            data-testid="landing-nav-events"
            className="hidden min-h-11 items-center rounded-md px-3 hover:text-ds-link sm:inline-flex"
          >
            {t("landing.nav.events")}
          </Link>
          <Link
            to="/auth"
            data-testid="landing-sign-in"
            className="inline-flex min-h-11 items-center rounded-md px-3 hover:text-ds-link"
          >
            {t("landing.nav.signIn")}
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            data-testid="landing-join"
            className="inline-flex min-h-11 items-center rounded-[3px] bg-ds-slate px-4 text-ds-slate-fg transition-colors hover:bg-ds-action hover:text-ds-action-fg"
          >
            {t("landing.nav.join")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
