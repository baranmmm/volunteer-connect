import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";
import { PublicShell } from "@/components/public/PublicShell";
import { GuestLinkPage } from "@/components/public/GuestLinkPage";
import { noReferrer, validateTokenSearch } from "@/components/public/link-search";

/** Public: the guest's email link (/e/confirm?t=). Shows the event; the place is taken only after a click. */
export const Route = createFileRoute("/e/confirm")({
  ssr: false,
  validateSearch: validateTokenSearch,
  head: () => {
    const head = pageHead(
      "Confirm your registration",
      "Confirm your place at a Dialogue Society event.",
    );
    return { meta: [...head.meta, noReferrer] };
  },
  component: ConfirmPage,
});

function ConfirmPage() {
  const { t } = Route.useSearch();
  return (
    <PublicShell>
      <GuestLinkPage mode="confirm" token={t} />
    </PublicShell>
  );
}
