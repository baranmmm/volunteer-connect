import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchRegionGroups } from "@/lib/branches";
import { followBranch, unfollowBranch, useFollowedBranches } from "@/lib/followed-branches";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Profile: branches the member follows (at least one for followers; members always follow their own branch). */
export function FollowedBranches() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const qc = useQueryClient();
  const followed = useFollowedBranches(session?.user.id);
  const groups = useQuery({ queryKey: ["region-groups"], queryFn: fetchRegionGroups, staleTime: 600_000 });
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const onlyOne = (followed.data ?? []).length <= 1;
  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(message));
      await qc.invalidateQueries({ queryKey: ["followed-branches"] });
      await qc.invalidateQueries({ queryKey: ["events"] });
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const followedIds = new Set((followed.data ?? []).map((b) => b.branch_id));
  return (
    <section data-testid="profile-followed-branches" aria-labelledby="followed-h" className="max-w-xl space-y-3 rounded-2xl border bg-card p-6 shadow-soft">
      <h2 id="followed-h" className="text-xl font-semibold">{t("profile.followedTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("profile.followedIntro")}</p>
      <ul className="flex flex-wrap gap-2">
        {(followed.data ?? []).map((b) => (
          <li key={b.branch_id} data-testid="profile-followed-branch" data-branch-id={b.branch_id}>
            <Badge variant="secondary" className="gap-1 py-1 pl-3 text-sm">
              {b.name}
              {b.own ? <span className="text-xs text-muted-foreground">({t("profile.ownBranch")})</span> : (
                <button type="button" data-testid="profile-unfollow-branch" disabled={busy || (onlyOne && !(followed.data ?? []).some((x) => x.own))}
                  aria-label={t("profile.unfollow", { branch: b.name })} className="ml-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
                  onClick={() => void run(() => unfollowBranch(b.branch_id), "profile.unfollowed")}><X className="size-3.5" aria-hidden /></button>
              )}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="follow-branch" className="sr-only">{t("profile.followBranch")}</label>
        <select id="follow-branch" data-testid="profile-follow-branch-select" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-11 min-w-48 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="">{t("profile.chooseBranchToFollow")}</option>
          {(groups.data ?? []).map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.branches.filter((b) => !followedIds.has(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </optgroup>
          ))}
        </select>
        <Button data-testid="profile-follow-branch-button" variant="outline" className="h-11" disabled={busy || !adding}
          onClick={() => void run(async () => { await followBranch(adding); setAdding(""); }, "profile.followed")}><Plus />{t("profile.followBranch")}</Button>
      </div>
    </section>
  );
}
