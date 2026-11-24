import { createFileRoute } from "@tanstack/react-router";
import { useRedirect } from "@/lib/use-redirect";
import { useAuth } from "@/lib/auth";
import { Landing } from "@/components/landing/Landing";
import { Splash } from "@/components/landing/Splash";
import { landingHero, landingQuery } from "@/lib/landing.functions";
import { hasStoredSession } from "@/lib/supabase-lazy";
import { eventImageUrl, pageMeta, siteOrigin } from "@/lib/public-meta";

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(String(import.meta.env["VITE_SUPABASE_URL"] ?? "")).origin;
  } catch {
    return null;
  }
})();
const TITLE = "Dialogue Society: events, dialogue and community";
const DESCRIPTION =
  "Upcoming public events of the Dialogue Society across the UK: talks, dinners and community gatherings. Register, see past events and get event updates.";

// Server-rendered for signed-out visitors (content, hero image and link previews in the HTML). The server never
// knows the session (it lives in localStorage): members get the same HTML, hidden until they are sent to /dashboard.
export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    // A member navigating here in the browser is redirected: no landing data for them.
    if (typeof window !== "undefined" && hasStoredSession())
      return { landing: null, origin: window.location.origin };
    const [landing, origin] = await Promise.all([
      context.queryClient.ensureQueryData(landingQuery).catch(() => null),
      siteOrigin(),
    ]);
    return { landing, origin };
  },
  // The image links in the HTML are signed for 5 minutes: never store the page in a cache.
  headers: () => ({ "Cache-Control": "private, no-store" }),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const hero = loaderData?.landing ? landingHero(loaderData.landing).event : undefined;
    // The next event's cover through the stable preview route; else a Dialogue Society photo.
    const image =
      hero?.image && origin ? eventImageUrl(origin, hero.id) : `${origin}/auth/join-1600.webp`;
    const head = pageMeta({
      title: TITLE,
      description: DESCRIPTION,
      url: `${origin}/`,
      image,
      imageAlt: hero?.image ? hero.title : "Dialogue Society volunteers at an event",
    });
    return {
      ...head,
      // Signed image links (hero, cards) come from the Supabase origin: open that connection early.
      links: [
        ...head.links,
        ...(SUPABASE_ORIGIN ? [{ rel: "preconnect", href: SUPABASE_ORIGIN }] : []),
      ],
    };
  },
  component: Index,
});

/** Signed-in members go straight to their dashboard (nothing of the landing flashes); visitors see the landing. */
function Index() {
  const { loading, session } = useAuth();
  const { landing } = Route.useLoaderData();
  useRedirect(!loading && !!session, "/dashboard");
  if (session) return <Splash />;
  // Until the session is known (server, hydration): the landing, hidden for a stored session, which sees the splash.
  return (
    <>
      {loading ? (
        <div data-session-only="">
          <Splash />
        </div>
      ) : null}
      <div data-signed-out-only="">
        <Landing initial={landing} />
      </div>
    </>
  );
}
