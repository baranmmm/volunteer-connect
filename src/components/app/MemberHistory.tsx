import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchHistory, type Member } from "@/lib/members";
import { fetchRegionGroups } from "@/lib/branches";
import { ROLE_LABELS } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function MemberHistory({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const history = useInfiniteQuery({
    queryKey: ["member-history", member?.id],
    queryFn: ({ pageParam }) => member ? fetchHistory(member.id, pageParam) : Promise.resolve([]),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => page.length === 100 ? pages.length * 100 : undefined,
    enabled: !!member,
  });
  const groups = useQuery({ queryKey: ["region-groups"], queryFn: fetchRegionGroups, enabled: !!member });
  const branches = groups.data?.flatMap((r) => r.branches) ?? [];
  const roleName = (value: string | null) => value && value in ROLE_LABELS ? ROLE_LABELS[value as keyof typeof ROLE_LABELS] : "No role";
  const branchName = (value: string | null) => branches.find((b) => b.id === value)?.name ?? "No branch";

  return <Sheet open={!!member} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>History</SheetTitle>
        <SheetDescription>{member?.full_name || "Unnamed"}</SheetDescription>
      </SheetHeader>
      <div className="p-4">
        {history.isLoading ? <p className="text-muted-foreground">Loading…</p> : history.isError ? <div role="alert"><p className="text-destructive">History could not be loaded.</p><Button variant="outline" onClick={() => history.refetch()}>Retry</Button></div> : !history.data?.pages.flat().length ? <p className="text-muted-foreground">No changes recorded yet.</p> :
          <ol className="divide-y">{history.data.pages.flat().map((entry) => {
            const change = entry.action === "user_deleted" ? "User deletion authorized" : entry.action === "user_deletion_failed" ? "User deletion failed" : entry.action === "deletion_requested" ? "Account deletion requested" : entry.action === "deletion_cancelled" ? "Account deletion request cancelled" : entry.action === "role_change" ? `Role changed from ${roleName(entry.old_value)} to ${roleName(entry.new_value)}` : entry.action === "branch_change" ? `Branch changed from ${branchName(entry.old_value)} to ${branchName(entry.new_value)}` : entry.old_value === "pending" && entry.new_value === "active" ? "Approved" : entry.new_value === "active" ? "Activated" : entry.new_value === "inactive" ? "Deactivated" : "Status changed to Pending";
            return <li key={entry.id} className="py-4 text-sm leading-6 break-words">
              <p>{change} by <span className="font-semibold">{entry.actor_name}</span></p>
              <time className="text-muted-foreground" dateTime={entry.created_at}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(entry.created_at))}</time>
            </li>;
          })}</ol>}
        {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? "Loading…" : "Load more"}</Button>}
      </div>
    </SheetContent>
  </Sheet>;
}