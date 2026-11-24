import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";
import { PublicShell } from "@/components/public/PublicShell";
import { GuestLinkPage } from "@/components/public/GuestLinkPage";
import { noReferrer, validateTokenSearch } from "@/components/public/link-search";

/** Public: the guest's email link (/e/cancel?t=). Shows the event; cancelling needs a click (mail scanners open links). */
export const Route = createFileRoute("/e/cancel")({
  ssr: false,
  validateSearch: validateTokenSearch,
  head: () => {
    const head = pageHead(
      "Cancel your registration",
      "Cancel your place at a Dialogue Society event.",
    );
    return { meta: [...head.meta, noReferrer] };
  },
  component: CancelPage,
});

function CancelPage() {
  const { t } = Route.useSearch();
  return (
    <PublicShell>
      <GuestLinkPage mode="cancel" token={t} />
    </PublicShell>
  );
}
