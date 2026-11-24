import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth/AuthPage";
import { safeRedirect } from "@/lib/auth-redirect";
import { pageMeta, siteOrigin } from "@/lib/public-meta";

const TITLE = "Join · Dialogue Society Volunteer Hub";
const DESCRIPTION =
  "Create your Dialogue Society account: follow your local branch's events or apply to volunteer.";

/** Server-rendered sign-up page (the same page as /auth?mode=signup). */
export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" && safeRedirect(search["redirect"])
      ? { redirect: search["redirect"] }
      : {},
  loader: async () => ({ origin: await siteOrigin() }),
  headers: () => ({ "Cache-Control": "private, no-cache" }),
  head: ({ loaderData }) =>
    pageMeta({
      title: TITLE,
      description: DESCRIPTION,
      url: `${loaderData?.origin ?? ""}/join`,
      image: `${loaderData?.origin ?? ""}/auth/join-1600.webp`,
      imageAlt: "Dialogue Society volunteers at an event",
    }),
  component: JoinPage,
});

function JoinPage() {
  const { redirect } = Route.useSearch();
  return <AuthPage redirect={redirect} initialMode="signup" />;
}
