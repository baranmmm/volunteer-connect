import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/app/ComingSoon";

export const Route = createFileRoute("/_app/media")({
  head: () => ({
    meta: [
      { title: "Media · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Media for Dialogue Society volunteers — coming soon." },
      { property: "og:title", content: "Media · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Media for Dialogue Society volunteers — coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComingSoon title="Media" />,
});
