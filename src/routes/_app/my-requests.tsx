import { createFileRoute, Navigate } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";

export const Route = createFileRoute("/_app/my-requests")({
  ssr: false,
  head: () =>
    pageHead(
      "My requests · Requests",
      "Your Dialogue Society requests are now in the shared Requests workspace.",
    ),
  component: () => <Navigate to="/requests" search={{ tab: "mine" }} replace />,
});
