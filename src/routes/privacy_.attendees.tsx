import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { pageMeta, siteOrigin } from "@/lib/public-meta";
import { LogoLink } from "@/components/app/LogoLink";
import { PrivacyNotice } from "@/components/app/PrivacyNotice";
import { parseMarkdown } from "@/lib/markdown";
import notice from "@/content/attendee-privacy-notice.md?raw";
import noticeTr from "@/content/attendee-privacy-notice.tr.md?raw";

// The member notice (/privacy) keeps its own version; this one covers guests and "Get event updates" subscribers.
const BLOCKS = { en: parseMarkdown(notice), tr: parseMarkdown(noticeTr) };

/** Public: /privacy/attendees, linked from the guest registration and event updates forms. Server-rendered. */
export const Route = createFileRoute("/privacy_/attendees")({
  loader: async () => ({ origin: await siteOrigin() }),
  headers: () => ({ "Cache-Control": "private, no-cache" }),
  head: ({ loaderData }) =>
    pageMeta({
      title: "Event attendee privacy notice · Dialogue Society",
      description:
        "How the Dialogue Society uses the details of event guests and event update subscribers.",
      url: `${loaderData?.origin ?? ""}/privacy/attendees`,
    }),
  component: AttendeePrivacyPage,
});

function AttendeePrivacyPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      <main
        data-testid="attendee-privacy-page"
        className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6"
      >
        <div className="flex items-center justify-between gap-4">
          <LogoLink size="sm" />
          <Link
            to="/events"
            className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("attendeePrivacy.back")}
          </Link>
        </div>
        <PrivacyNotice blocks={BLOCKS} testId="attendee-privacy-notice" />
      </main>
    </div>
  );
}
