import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";
import { PublicTopBar } from "@/components/public/PublicTopBar";
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
  return (
    <div className="min-h-screen bg-background">
      <PublicTopBar />
      <main data-testid="privacy-page" className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <PrivacyNotice />
      </main>
    </div>
  );
}
