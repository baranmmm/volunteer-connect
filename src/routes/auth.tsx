import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth/AuthPage";
import { safeRedirect } from "@/lib/auth-redirect";

// The original sign-in / join address, still used by e-mails, bookmarks and tests; client-only like the member pages.
// /sign-in and /join render the same page on the server.
export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Sign in or create your volunteer account." },
      { property: "og:title", content: "Sign in · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Sign in or create your volunteer account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // ?redirect=/events/<id> returns there after signing in; ?mode=signup opens the sign-up form.
  validateSearch: (search: Record<string, unknown>): { redirect?: string; mode?: "signup" } => ({
    ...(typeof search["redirect"] === "string" && safeRedirect(search["redirect"])
      ? { redirect: search["redirect"] }
      : {}),
    ...(search["mode"] === "signup" ? { mode: "signup" as const } : {}),
  }),
  component: AuthRoute,
});

function AuthRoute() {
  const search = Route.useSearch();
  return (
    <AuthPage
      redirect={search.redirect}
      initialMode={search.mode === "signup" ? "signup" : "signin"}
    />
  );
}
