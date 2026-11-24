import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth/AuthPage";
import { safeRedirect } from "@/lib/auth-redirect";
import { pageMeta, siteOrigin } from "@/lib/public-meta";

const TITLE = "Sign in · Dialogue Society Volunteer Hub";
const DESCRIPTION = "Sign in to the Dialogue Society Volunteer Hub.";

/** Server-rendered sign-in page (the same page as /auth). ?redirect=/events/<id> returns there after signing in. */
export const Route = createFileRoute("/sign-in")({
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
      url: `${loaderData?.origin ?? ""}/sign-in`,
      image: `${loaderData?.origin ?? ""}/auth/signin-1600.webp`,
      imageAlt: "Dialogue Society volunteers at an event",
    }),
  component: SignInPage,
});

function SignInPage() {
  const { redirect } = Route.useSearch();
  return <AuthPage redirect={redirect} initialMode="signin" />;
}
