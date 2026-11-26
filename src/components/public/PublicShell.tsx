import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PublicTopBar } from "@/components/public/PublicTopBar";

/**
 * Layout of the signed-out public pages without the landing sections (/events/:id, the email-link pages): the public
 * top bar and a privacy notice link.
 */
export function PublicShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const width = wide ? "max-w-7xl" : "max-w-5xl";
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      <PublicTopBar />
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
