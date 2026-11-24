import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogoLink } from "@/components/app/LogoLink";
import { useAuth } from "@/lib/auth";

/** Layout of the signed-out public pages (/events, /events/:id): no member navigation, a privacy notice link. */
export function PublicShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const width = wide ? "max-w-7xl" : "max-w-5xl";
  const { t } = useTranslation();
  const { session } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div
          className={`mx-auto flex ${width} flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6`}
        >
          <LogoLink size="sm" />
          <nav aria-label={t("publicEvents.navLabel")} className="flex items-center gap-4 text-sm">
            <Link
              to="/events"
              data-testid="public-nav-events"
              className="min-h-11 content-center font-medium hover:text-primary"
            >
              {t("publicEvents.title")}
            </Link>
            {session ? (
              <Link
                to="/dashboard"
                data-testid="public-nav-dashboard"
                className="min-h-11 content-center font-medium hover:text-primary"
              >
                {t("navigation.dashboard")}
              </Link>
            ) : (
              <Link
                to="/auth"
                data-testid="public-nav-sign-in"
                className="min-h-11 content-center font-medium hover:text-primary"
              >
                {t("publicEvents.signIn")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      {/* The wide layout (/events with its map) fills the screen, so the footer never jumps while the list loads. */}
      <main className={`mx-auto ${width} px-4 py-6 sm:px-6 ${wide ? "min-h-screen" : ""}`}>
        {children}
      </main>
      <footer className={`mx-auto ${width} px-4 pb-8 text-sm text-muted-foreground sm:px-6`}>
        <Link
          to="/privacy"
          data-testid="public-privacy-link"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {t("publicEvents.privacyLink")}
        </Link>
      </footer>
    </div>
  );
}
