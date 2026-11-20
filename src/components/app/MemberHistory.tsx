import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { fetchHistory, type Member } from "@/lib/members";
import { fetchRegionGroups } from "@/lib/branches";
import { formatDate } from "@/lib/i18n";
import { historyChange } from "@/lib/history";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function MemberHistory({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { t } = useTranslation();
  const history = useInfiniteQuery({
    queryKey: ["member-history", member?.id],
    queryFn: ({ pageParam }) => member ? fetchHistory(member.id, pageParam) : Promise.resolve([]),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => page.length === 100 ? pages.length * 100 : undefined,
    enabled: !!member,
  });
  const groups = useQuery({ queryKey: ["region-groups"], queryFn: fetchRegionGroups, enabled: !!member });
  const branches = groups.data?.flatMap((r) => r.branches) ?? [];
  const branchName = (value: string | null) => branches.find((b) => b.id === value)?.name ?? t("common.noBranch");

  return <Sheet open={!!member} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent data-testid="history-panel" className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>{t("history.title")}</SheetTitle>
        <SheetDescription>{member?.full_name || t("common.unnamed")}</SheetDescription>
      </SheetHeader>
      <div className="p-4">
        {history.isLoading ? <p className="text-muted-foreground">{t("common.loading")}</p> : history.isError ? <div data-testid="history-load-error" role="alert"><p className="text-destructive">{t("history.loadError")}</p><Button variant="outline" onClick={() => history.refetch()}>{t("common.retry")}</Button></div> : !history.data?.pages.flat().length ? <p data-testid="history-empty" className="text-muted-foreground">{t("history.empty")}</p> :
          <ol className="divide-y">{history.data.pages.flat().map((entry) => {
            const c = historyChange(entry);
            const params = { ...c.params, from: c.branch ? branchName(entry.old_value) : c.params?.from && t(c.params.from), to: c.branch ? branchName(entry.new_value) : c.params?.to && t(c.params.to) };
            return <li key={entry.id} data-testid="history-entry" data-action={entry.action} className="py-4 text-sm leading-6 break-words">
              <p><Trans i18nKey="history.by" values={{ change: t(c.key, params), actor: entry.actor_name }} components={{ bold: <span className="font-semibold" /> }} /></p>
              <time className="text-muted-foreground" dateTime={entry.created_at}>{formatDate(entry.created_at, { dateStyle: "medium", timeStyle: "short" })}</time>
            </li>;
          })}</ol>}
        {history.hasNextPage && <Button data-testid="history-load-more-button" variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? t("common.loading") : t("history.loadMore")}</Button>}
      </div>
    </SheetContent>
  </Sheet>;
}
