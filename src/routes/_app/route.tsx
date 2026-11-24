import { createFileRoute, Outlet, useLocation, useMatches } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useRedirect } from "@/lib/use-redirect";
import { useAuth } from "@/lib/auth";
import { PublicShell } from "@/components/public/PublicShell";
import { hasStoredSession } from "@/lib/supabase-lazy";

// The member shell (navigation, gates, notification counts) is its own chunk, loaded only with a session.
const loadMemberShell = () => import("@/components/app/MemberShell");
const MemberShell = lazy(() => loadMemberShell().then((m) => ({ default: m.MemberShell })));
// A member opening the app: start the download at once instead of after the session check.
if (typeof window !== "undefined" && hasStoredSession()) void loadMemberShell();

/** The only member route that is server-rendered: a public event's page, whose signed-out view is public. */
const SERVER_RENDERED = "/_app/events_/$id";

export const Route = createFileRoute("/_app")({
  // Signed-in pages stay client-only (ssr: false). The exception is /events/:id: its signed-out public view is
  // server-rendered for speed and link previews (the server never knows the session; members get their view after
  // hydration). The router passes the matched routes at run time (not in the option's type).
  ssr: (ctx) =>
    (ctx as unknown as { matches?: { routeId: string }[] }).matches?.some(
      (m) => m.routeId === SERVER_RENDERED,
    ) ?? false,
  component: AppLayout,
});

function AppLoading() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="app-loading"
      className="flex min-h-screen items-center justify-center text-muted-foreground"
    >
      {t("common.loading")}
    </div>
  );
}

function AppLayout() {
  const { loading, session } = useAuth();
  const { pathname } = useLocation();
  // A public event's page (/events/:id) also works signed out, in the public layout.
  const publicPath = pathname.startsWith("/events/");
  // Only a member page sends signed-out visitors to /auth: while leaving for a public page (e.g. /sign-in from an
  // event) this layout can still render once with the new address.
  const memberPage = useMatches({
    select: (matches) =>
      matches.some((m) => m.routeId.startsWith("/_app/") && m.routeId !== SERVER_RENDERED),
  });
  useRedirect(!loading && !session && !publicPath && memberPage, "/auth");

  // Signed out (or not known yet, as on the server): the public layout. With a stored session it stays hidden
  // ([data-signed-out-only]) and the loading line shows ([data-session-only]) until the member view takes over.
  if (publicPath && !session)
    return (
      <>
        {loading ? (
          <div data-session-only="">
            <AppLoading />
          </div>
        ) : null}
        <div data-signed-out-only="">
          <PublicShell>
            <Outlet />
          </PublicShell>
        </div>
      </>
    );
  if (loading) return <AppLoading />;
  if (!session) return null;
  return (
    <Suspense fallback={<AppLoading />}>
      <MemberShell />
    </Suspense>
  );
}
