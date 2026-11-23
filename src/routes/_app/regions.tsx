import { createFileRoute } from "@tanstack/react-router";
import { BranchName } from "@/components/app/BranchName";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents } from "@/lib/events.functions";
import { eventTimeState, isScheduled } from "@/lib/event-rules";
import { useTranslation } from "react-i18next";
import { Building2, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { useAuth } from "@/lib/auth";
import { isNationalCoordinator } from "@/lib/roles";
import {
  createBranch,
  createRegion,
  deleteBranch,
  deleteRegion,
  renameBranch,
  renameRegion,
  useRegionsTree,
  type Person,
} from "@/lib/national";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventDialog } from "@/components/events/EventDialog";

export const Route = createFileRoute("/_app/regions")({
  ssr: false,
  head: () => pageHead("Regions & branches", "Dialogue Society regions and branches."),
  component: RegionsPage,
});

type Editing = { kind: "region" | "branch"; id?: string; regionId?: string; name: string } | null;

/** National Coordinators: the region → branch tree with managers, numbers, and create / rename / delete. */
function RegionsPage() {
  const { t } = useTranslation();
  const { session, roles } = useAuth();
  const nc = isNationalCoordinator(roles);
  const tree = useRegionsTree(session?.user.id, nc);
  // Region-wide events only (scope = region), not the sum of branch events; same cache as the calendar.
  const { profile } = useAuth();
  const fetchEvents = useServerFn(listEvents);
  const events = useQuery({
    queryKey: ["events", session?.user.id, profile?.status],
    queryFn: () => fetchEvents(),
    enabled: nc && profile?.status === "active",
    staleTime: 240000,
  });
  const regionWide = (regionId: string) => {
    const now = new Date();
    return (events.data ?? []).filter(
      (e) =>
        e.scope === "region" &&
        e.region_id === regionId &&
        e.status === "published" &&
        isScheduled(e) &&
        !eventTimeState(e, now).past,
    ).length;
  };
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(message));
      // A first load still in flight was started before this change: invalidating alone would wait for it
      // (no data yet, so TanStack Query does not refetch) and show the old tree. Cancel it, then refetch.
      await qc.cancelQueries({ queryKey: ["regions-tree"] });
      void qc.invalidateQueries({ queryKey: ["regions-tree"] });
      void qc.invalidateQueries({ queryKey: ["nc-dashboard"] });
      return true;
    } catch (e) {
      toast.error(translateError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { kind, id, regionId, name } = editing;
    const ok = await run(
      () =>
        kind === "region"
          ? id
            ? renameRegion(id, name)
            : createRegion(name)
          : id
            ? renameBranch(id, name)
            : createBranch(name, regionId!),
      id ? "regions.saved" : "regions.created",
    );
    if (ok) setEditing(null);
  }
  const people = (list: Person[], testId: string) =>
    list.length ? (
      <ul className="space-y-1">
        {list.map((p) => (
          <li key={p.id} data-testid={testId} className="text-sm">
            <span className="font-medium">{p.name}</span>
            {[p.email, p.phone].filter(Boolean).map((v) => (
              <span key={v} className="text-muted-foreground">
                {" "}
                · {v}
              </span>
            ))}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">{t("regions.nobody")}</p>
    );
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <Network className="size-7 text-primary" aria-hidden />
          {t("regions.title")}
        </h1>
        <Button
          data-testid="region-create"
          className="h-11"
          onClick={() => setEditing({ kind: "region", name: "" })}
        >
          <Plus />
          {t("regions.newRegion")}
        </Button>
      </header>
      {tree.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : tree.isError ? (
        <p role="alert" className="text-destructive">
          {translateError(tree.error)}
        </p>
      ) : (
        <ul data-testid="regions-tree" className="space-y-5">
          {(tree.data ?? []).map((r) => (
            <li
              key={r.id}
              data-testid="regions-tree-region"
              data-region-id={r.id}
              className="space-y-4 rounded-2xl border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">{r.name}</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="branch-create"
                    onClick={() => setEditing({ kind: "branch", regionId: r.id, name: "" })}
                  >
                    <Plus />
                    {t("regions.newBranch")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="region-rename"
                    aria-label={t("regions.rename", { name: r.name })}
                    onClick={() => setEditing({ kind: "region", id: r.id, name: r.name })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="region-delete"
                    aria-label={t("regions.delete", { name: r.name })}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t("regions.confirmDeleteRegion", { name: r.name })))
                        void run(() => deleteRegion(r.id), "regions.deleted");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <h3 className="font-medium">{t("regions.directors")}</h3>
                  {people(r.directors, "regions-tree-director")}
                </div>
                <p className="text-muted-foreground">
                  {t("regions.regionEvents", { count: regionWide(r.id) })}
                </p>
              </div>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {r.branches.map((b) => (
                  <li
                    key={b.id}
                    data-testid="regions-tree-branch"
                    data-branch-id={b.id}
                    className="space-y-2 rounded-xl border p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="flex min-w-0 items-center gap-2 font-semibold">
                        <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
                        <BranchName name={b.name} />
                      </h3>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid="branch-rename"
                          aria-label={t("regions.rename", { name: b.name })}
                          onClick={() => setEditing({ kind: "branch", id: b.id, name: b.name })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid="branch-delete"
                          aria-label={t("regions.delete", { name: b.name })}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t("regions.confirmDeleteBranch", { name: b.name })))
                              void run(() => deleteBranch(b.id), "regions.deleted");
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium">{t("regions.managers")}</h4>
                      {people(b.managers, "regions-tree-manager")}
                    </div>
                    <p
                      data-testid="regions-tree-branch-counts"
                      data-volunteers={b.volunteers}
                      data-followers={b.followers}
                      className="text-sm text-muted-foreground"
                    >
                      {t("regions.branchCounts", {
                        volunteers: b.volunteers,
                        followers: b.followers,
                        events: b.upcoming_events,
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EventDialog
          open
          onClose={() => setEditing(null)}
          title={t(
            editing.id
              ? "regions.renameTitle"
              : editing.kind === "region"
                ? "regions.newRegion"
                : "regions.newBranch",
          )}
        >
          <form data-testid="regions-form" onSubmit={(e) => void save(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="regions-name">{t("regions.name")}</Label>
              <Input
                id="regions-name"
                data-testid="regions-name-input"
                value={editing.name}
                maxLength={80}
                required
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                data-testid="regions-save"
                disabled={busy || editing.name.trim().length < 2}
              >
                {t("common.save")}
              </Button>
            </div>
          </form>
        </EventDialog>
      )}
    </div>
  );
}
