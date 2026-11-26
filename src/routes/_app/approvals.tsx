import { createFileRoute, Navigate } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";

// Approvals (pending sign-ups, account deletion requests) is now Requests → "Waiting for my approval". Old links and
// bookmarks land there; people without review rights see their own requests.
export const Route = createFileRoute("/_app/approvals")({
  ssr: false,
  head: () => pageHead("Requests", "Approvals are now in Requests: Waiting for my approval."),
  component: () => <Navigate to="/requests" search={{ tab: "review" }} replace />,
});
