import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/app/ComingSoon";

export const Route = createFileRoute("/_app/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Contacts for Dialogue Society volunteers — coming soon." },
      { property: "og:title", content: "Contacts · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Contacts for Dialogue Society volunteers — coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComingSoon title="Contacts" />,
});
