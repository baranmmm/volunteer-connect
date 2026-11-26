import { createFileRoute } from "@tanstack/react-router";
import { JoinPage, JOIN_DESCRIPTION, JOIN_TITLE } from "@/components/auth/JoinPage";
import { safeRedirect } from "@/lib/auth-redirect";
import { pageMeta, siteOrigin } from "@/lib/public-meta";

/**
 * Server-rendered sign-up page: the same page as the home page (/), kept for links with ?redirect= (back to a public
 * event after joining) and older links. Its canonical address is the home page.
 */
export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" && safeRedirect(search["redirect"])
      ? { redirect: search["redirect"] }
      : {},
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
  component: JoinRoute,
});

function JoinRoute() {
  const { redirect } = Route.useSearch();
  return <JoinPage redirect={redirect} />;
}
