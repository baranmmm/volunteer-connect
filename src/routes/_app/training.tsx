import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/app/ComingSoon";

export const Route = createFileRoute("/_app/training")({
  head: () => ({
    meta: [
      { title: "Training · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Training for Dialogue Society volunteers — coming soon." },
      { property: "og:title", content: "Training · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Training for Dialogue Society volunteers — coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComingSoon title="Training" />,
});
