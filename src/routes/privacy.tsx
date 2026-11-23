import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Logo } from "@/components/app/Logo";
import { PrivacyNotice } from "@/components/app/PrivacyNotice";

/** Public: opens without signing in (linked from sign-up, the confirmation screen and the profile). */
export const Route = createFileRoute("/privacy")({
  ssr: false,
  head: () =>
    pageHead(
      "Privacy notice",
      "How the Dialogue Society Volunteer Hub uses your personal information.",
    ),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      <main data-testid="privacy-page" className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Logo size="sm" />
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("privacy.back")}
          </Link>
        </div>
        <PrivacyNotice />
      </main>
    </div>
  );
}
