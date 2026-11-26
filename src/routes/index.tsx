import { createFileRoute } from "@tanstack/react-router";
import { useRedirect } from "@/lib/use-redirect";
import { useAuth } from "@/lib/auth";
import { Splash } from "@/components/landing/Splash";
import { JoinPage, JOIN_DESCRIPTION, JOIN_TITLE } from "@/components/auth/JoinPage";
import { pageMeta, siteOrigin } from "@/lib/public-meta";

// The home page is the join page (sign-up form), server-rendered for signed-out visitors and link previews. The
// public events, gallery and highlights (the former landing page) live on /events. The server never knows the
// session (it lives in localStorage): members get the same HTML, hidden until they are sent to /dashboard.
export const Route = createFileRoute("/")({
  loader: async () => ({ origin: await siteOrigin() }),
  headers: () => ({ "Cache-Control": "private, no-cache" }),
  head: ({ loaderData }) =>
    pageMeta({
      title: JOIN_TITLE,
      description: JOIN_DESCRIPTION,
      url: `${loaderData?.origin ?? ""}/`,
      image: `${loaderData?.origin ?? ""}/auth/join-1600.webp`,
      imageAlt: "Dialogue Society volunteers at an event",
    }),
  component: Index,
});

/** Signed-in members go straight to their dashboard (nothing of the join page flashes); visitors see the join page. */
function Index() {
  const { loading, session } = useAuth();
  useRedirect(!loading && !!session, "/dashboard");
  if (session) return <Splash />;
  // Until the session is known (server, hydration): the join page, hidden for a stored session, which sees the splash.
  return (
    <>
      {loading ? (
        <div data-session-only="">
          <Splash />
        </div>
      ) : null}
      <JoinPage />
    </>
  );
}
