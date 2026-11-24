import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";
import { PublicShell } from "@/components/public/PublicShell";
import { noReferrer, validateTokenSearch } from "@/components/public/link-search";
import { SubscriberLinkPage } from "@/components/public/SubscriberLinkPage";

/**
 * Public: unsubscribe from "Get event updates" (/updates/unsubscribe?t=) with one click. Mail providers use the
 * RFC 8058 endpoint POST /api/public/unsubscribe?t= instead.
 */
export const Route = createFileRoute("/updates/unsubscribe")({
  ssr: false,
  validateSearch: validateTokenSearch,
  head: () => {
    const head = pageHead("Unsubscribe", "Stop Dialogue Society event updates by email.");
    return { meta: [...head.meta, noReferrer] };
  },
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { t } = Route.useSearch();
  return (
    <PublicShell>
      <SubscriberLinkPage mode="unsubscribe" token={t} />
    </PublicShell>
  );
}
