import { createFileRoute } from "@tanstack/react-router";
import { pageMeta, siteOrigin } from "@/lib/public-meta";
import { PublicTopBar } from "@/components/public/PublicTopBar";
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
  return (
    <div className="min-h-screen bg-background">
      <PublicTopBar />
      <main
        data-testid="attendee-privacy-page"
        className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6"
      >
        <PrivacyNotice blocks={BLOCKS} testId="attendee-privacy-notice" />
      </main>
    </div>
  );
}
