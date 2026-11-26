import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/head";
import { PublicShell } from "@/components/public/PublicShell";
import { NoticeEmailLinkPage } from "@/components/public/NoticeEmailLinkPage";
import { noReferrer, validateTokenSearch } from "@/components/public/link-search";

/** Public: "stop these emails" from a member notice email (/e/notices?t=). Turning them off needs a click. */
export const Route = createFileRoute("/e/notices")({
  ssr: false,
  validateSearch: validateTokenSearch,
  head: () => {
    const head = pageHead(
      "Email notifications",
      "Stop one kind of Dialogue Society Volunteer Hub email.",
    );
    return { meta: [...head.meta, noReferrer] };
  },
  component: NoticesPage,
});

function NoticesPage() {
  const { t } = Route.useSearch();
  return (
    <PublicShell>
      <NoticeEmailLinkPage token={t} />
    </PublicShell>
  );
}
