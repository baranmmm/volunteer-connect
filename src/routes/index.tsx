import { createFileRoute } from "@tanstack/react-router";
import { useRedirect } from "@/lib/use-redirect";
import { useAuth } from "@/lib/auth";
import { Landing } from "@/components/landing/Landing";
import { Splash } from "@/components/landing/Splash";
import { supabase } from "@/integrations/supabase/client";
import { LANDING_EARLY_SCRIPT, landingQuery } from "@/lib/landing.functions";

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

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Dialogue Society" },
      { name: "twitter:card", content: "summary" },
    ],
    // Signed image links (hero, cards) come from the Supabase origin: open that connection early.
    links: SUPABASE_ORIGIN ? [{ rel: "preconnect", href: SUPABASE_ORIGIN }] : [],
    // Starts the landing data and then the hero image while the page code is still downloading.
    scripts: [{ children: LANDING_EARLY_SCRIPT }],
  }),
  // Signed-out visitors: put the landing data (usually already fetched by LANDING_EARLY_SCRIPT) into the cache.
  loader: async ({ context }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) void context.queryClient.prefetchQuery(landingQuery);
  },
  pendingComponent: Splash,
  component: Index,
});

/** Signed-in members go straight to their dashboard (nothing of the landing flashes); visitors see the landing. */
function Index() {
  const { loading, session } = useAuth();
  useRedirect(!loading && !!session, "/dashboard");
  if (session || loading) return <Splash />;
  return <Landing />;
}
