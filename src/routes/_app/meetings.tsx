import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/app/ComingSoon";

export const Route = createFileRoute("/_app/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Meetings for Dialogue Society volunteers — coming soon." },
      { property: "og:title", content: "Meetings · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Meetings for Dialogue Society volunteers — coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComingSoon titleKey="navigation.meetings" />,
});
