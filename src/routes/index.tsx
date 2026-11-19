import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dialogue Society Volunteer Hub" },
      { name: "description", content: "Sign in to the Dialogue Society Volunteer Hub." },
      { property: "og:title", content: "Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Sign in to the Dialogue Society Volunteer Hub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const { loading, session } = useAuth();
  if (loading) return <div className="min-h-screen" />;
  return <Navigate to={session ? "/dashboard" : "/auth"} replace />;
}
