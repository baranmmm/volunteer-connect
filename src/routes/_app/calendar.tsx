import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/app/ComingSoon";

export const Route = createFileRoute("/_app/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Calendar for Dialogue Society volunteers — coming soon." },
      { property: "og:title", content: "Calendar · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Calendar for Dialogue Society volunteers — coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComingSoon titleKey="navigation.calendar" />,
});
