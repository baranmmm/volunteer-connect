import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";
import { PublicShell } from "@/components/public/PublicShell";
import { noReferrer, validateTokenSearch } from "@/components/public/link-search";
import { SubscriberLinkPage } from "@/components/public/SubscriberLinkPage";

/** Public: the double opt-in link of "Get event updates" (/updates/confirm?t=); confirming needs a click. */
export const Route = createFileRoute("/updates/confirm")({
  ssr: false,
  validateSearch: validateTokenSearch,
  head: () => {
    const head = pageHead(
      "Confirm your subscription",
      "Confirm Dialogue Society event updates by email.",
    );
    return { meta: [...head.meta, noReferrer] };
  },
  component: ConfirmSubscriptionPage,
});

function ConfirmSubscriptionPage() {
  const { t } = Route.useSearch();
  return (
    <PublicShell>
      <SubscriberLinkPage mode="confirm" token={t} />
    </PublicShell>
  );
}
