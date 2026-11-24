import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { pageHead } from "@/components/app/head";
import { PublicEventDetail } from "@/components/public/PublicEventDetail";
import { getPublicEvent } from "@/lib/public-events.functions";
import { hasStoredSession } from "@/lib/supabase-lazy";
import {
  eventDescription,
  eventImageUrl,
  eventJsonLd,
  jsonLdScript,
  pageMeta,
  siteOrigin,
} from "@/lib/public-meta";

// The member view (forms, files, registrations, tasks) is its own chunk: the public page never downloads it.
const loadMemberView = () => import("@/components/events/MemberEventDetail");
const MemberEventDetail = lazy(() =>
  loadMemberView().then((m) => ({ default: m.MemberEventDetail })),
);
// A member opening the page: start the download at once instead of after the session check.
if (typeof window !== "undefined" && hasStoredSession()) void loadMemberView();

export const Route = createFileRoute("/_app/events_/$id")({
  // Server-rendered (with its signed-out public view) through the /_app layout's ssr rule; see _app/route.tsx.
  validateSearch: (search: Record<string, unknown>): { edit?: boolean } =>
    search["edit"] === true || search["edit"] === "true" ? { edit: true } : {},
  // The public view of the event (null unless it is a public event): signed-out page and link previews (no personal
  // data, no online link). Its image links are signed for 5 minutes, so the HTML is never stored by caches.
  loader: async ({ params }) => {
    const [data, origin] = await Promise.all([
      getPublicEvent({ data: { id: params.id } }).catch(() => null),
      siteOrigin(),
    ]);
    return { data, origin };
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  head: ({ loaderData, params }) => {
    const event = loaderData?.data?.event;
    if (!event || !loaderData)
      return pageHead(
        "Event details",
        "View event details, private images and leaflets, and add Dialogue Society events to your calendar.",
      );
    const origin = loaderData.origin;
    const url = `${origin}/events/${params.id}`;
    const image = event.has_image ? eventImageUrl(origin, event.id) : null;
    const head = pageMeta({
      title: `${event.title} · Dialogue Society`,
      description: eventDescription(event),
      url,
      image,
      imageAlt: event.title,
    });
    return { ...head, scripts: [jsonLdScript(eventJsonLd(event, { url, origin, image }))] };
  },
  component: EventDetail,
});

/** Signed out: the public page of a public event. Signed in: the member view (RLS decides what is visible). */
function EventDetail() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { data } = Route.useLoaderData();
  if (session)
    return (
      <Suspense fallback={<p className="text-muted-foreground">{t("common.loading")}</p>}>
        <MemberEventDetail />
      </Suspense>
    );
  return <PublicEventDetail id={id} initial={data} />;
}
