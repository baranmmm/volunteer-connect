import { createFileRoute } from "@tanstack/react-router";
import { BranchName } from "@/components/app/BranchName";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents } from "@/lib/events.functions";
import { isMeetingEvent } from "@/lib/event-rules";
import { eventTimeState, isScheduled } from "@/lib/event-rules";
import { useTranslation } from "react-i18next";
import {
  Building2,
  List,
  Map as MapIcon,
  MapPin,
  Network,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
import {
  normalisePostcode,
  readRegionsView,
  saveRegionsView,
  useBranchMap,
  type MapBranch,
  type RegionsView,
} from "@/lib/branch-map";
import { saveBranchPostcode } from "@/lib/branch-map.functions";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventDialog } from "@/components/events/EventDialog";
import { BranchMap } from "@/components/regions/BranchMap";

export const Route = createFileRoute("/_app/regions")({
  ssr: false,
  head: () => pageHead("Regions & branches", "Dialogue Society regions and branches."),
  component: RegionsPage,
});

type Editing = {
  kind: "region" | "branch";
  id?: string;
  regionId?: string;
  name: string;
  /** Branches: the postcode field, and the saved name and postcode (to tell what changed). */
  postcode?: string;
  savedName?: string;
  savedPostcode?: string;
} | null;

/**
 * Regions & branches. National Coordinators: every branch on a map (the default view) or the region → branch tree
 * with managers, numbers, and create / rename / delete. Regional Directors: their region's branches, where they may
 * set a branch's postcode (its place on the map). The List view is the map's accessible alternative.
 */
function RegionsPage() {
  const { t } = useTranslation();
  const { session, roles } = useAuth();
  const nc = isNationalCoordinator(roles);
  const rd = !nc && roles.includes("regional_director");
  const tree = useRegionsTree(session?.user.id, nc);
  const map = useBranchMap(session?.user.id, nc || rd);
  const savePostcode = useServerFn(saveBranchPostcode);
  const [view, setViewState] = useState<RegionsView>(() => readRegionsView());
  const setView = (v: RegionsView) => {
    setViewState(v);
    saveRegionsView(v);
  };
  // "Open branch" on the map: the List view, scrolled to that branch.
  const [focusBranch, setFocusBranch] = useState<string | null>(null);
  const mapBranches = useMemo(() => new Map((map.data ?? []).map((b) => [b.id, b])), [map.data]);
  useEffect(() => {
    if (view !== "list" || !focusBranch) return;
    const el = document.querySelector<HTMLElement>(
      `[data-testid="regions-tree-branch"][data-branch-id="${focusBranch}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus();
  }, [view, focusBranch, tree.data, map.data]);
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
        // Meetings are in the calendar but are not region-wide events.
        !isMeetingEvent(e) &&
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
  async function refresh() {
    // A first load still in flight was started before this change: invalidating alone would wait for it
    // (no data yet, so TanStack Query does not refetch) and show the old tree. Cancel it, then refetch.
    await qc.cancelQueries({ queryKey: ["regions-tree"] });
    await qc.cancelQueries({ queryKey: ["branch-map"] });
    void qc.invalidateQueries({ queryKey: ["regions-tree"] });
    void qc.invalidateQueries({ queryKey: ["branch-map"] });
    void qc.invalidateQueries({ queryKey: ["nc-dashboard"] });
  }
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(message));
      await refresh();
      return true;
    } catch (e) {
      toast.error(translateError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const editBranch = (b: { id: string; name: string }) => {
    const postcode = mapBranches.get(b.id)?.postcode ?? "";
    setEditing({
      kind: "branch",
      id: b.id,
      name: b.name,
      savedName: b.name,
      postcode,
      savedPostcode: postcode,
    });
  };
  const postcodeValue = editing?.kind === "branch" ? normalisePostcode(editing.postcode ?? "") : "";
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { kind, id, regionId, name } = editing;
    if (kind === "region") {
      const ok = await run(
        () => (id ? renameRegion(id, name) : createRegion(name)),
        id ? "regions.saved" : "regions.created",
      );
      if (ok) setEditing(null);
      return;
    }
    if (postcodeValue === null) return;
    setBusy(true);
    let branchId = id;
    try {
      if (!branchId) {
        branchId = String(await createBranch(name, regionId!));
        // Created: if the postcode below fails, saving again must not create the branch twice.
        setEditing({ ...editing, id: branchId, savedName: name, savedPostcode: "" });
      } else if (nc && name.trim() !== editing.savedName) {
        await renameBranch(branchId, name);
      }
      let notLocated = false;
      if (postcodeValue !== (editing.savedPostcode ?? "")) {
        const result = await savePostcode({ data: { branchId, postcode: postcodeValue } });
        notLocated = !!result.postcode && !result.located;
      }
      if (notLocated) toast.error(t("regions.postcodeNotLocated"));
      else toast.success(t(id ? "regions.saved" : "regions.created"));
      setEditing(null);
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setBusy(false);
      await refresh();
    }
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
  const postcodeLine = (branchId: string) => {
    const postcode = mapBranches.get(branchId)?.postcode;
    return postcode ? (
      <p data-testid="regions-tree-branch-postcode" className="flex items-center gap-1 text-sm">
        <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
        {t("regions.postcodeValue", { postcode })}
      </p>
    ) : null;
  };
  const branchCard = (id: string, name: string, actions: ReactNode, body: ReactNode) => (
    <li
      key={id}
      data-testid="regions-tree-branch"
      data-branch-id={id}
      tabIndex={-1}
      className={`space-y-2 rounded-xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        focusBranch === id ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-semibold">
          <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
          <BranchName name={name} />
        </h3>
        <div className="flex gap-1">{actions}</div>
      </div>
      {body}
    </li>
  );
  const ncList = (
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
                onClick={() =>
                  setEditing({ kind: "branch", regionId: r.id, name: "", postcode: "" })
                }
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
            {r.branches.map((b) =>
              branchCard(
                b.id,
                b.name,
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="branch-rename"
                    aria-label={t("regions.rename", { name: b.name })}
                    onClick={() => editBranch(b)}
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
                </>,
                <>
                  <div>
                    <h4 className="text-sm font-medium">{t("regions.managers")}</h4>
                    {people(b.managers, "regions-tree-manager")}
                  </div>
                  {postcodeLine(b.id)}
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
                </>,
              ),
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
  // Regional Directors: their region's branches from the map data (counts and Branch Manager names only).
  const rdRegions = useMemo(() => {
    const byRegion = new Map<string, { id: string; name: string; branches: MapBranch[] }>();
    for (const b of map.data ?? []) {
      const r = byRegion.get(b.region_id) ?? { id: b.region_id, name: b.region, branches: [] };
      r.branches.push(b);
      byRegion.set(b.region_id, r);
    }
    return [...byRegion.values()];
  }, [map.data]);
  const rdList = (
    <ul data-testid="regions-tree" className="space-y-5">
      {rdRegions.map((r) => (
        <li
          key={r.id}
          data-testid="regions-tree-region"
          data-region-id={r.id}
          className="space-y-4 rounded-2xl border bg-card p-5"
        >
          <h2 className="text-xl font-semibold">{r.name}</h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {r.branches.map((b) =>
              branchCard(
                b.id,
                b.name,
                <Button
                  size="icon"
                  variant="ghost"
                  data-testid="branch-edit-location"
                  aria-label={t("regions.editLocation", { name: b.name })}
                  onClick={() => editBranch(b)}
                >
                  <MapPin />
                </Button>,
                <>
                  <div>
                    <h4 className="text-sm font-medium">{t("regions.managers")}</h4>
                    {b.managers.length ? (
                      <ul className="space-y-1 text-sm">
                        {b.managers.map((name) => (
                          <li key={name} data-testid="regions-tree-manager" className="font-medium">
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("regions.nobody")}</p>
                    )}
                  </div>
                  {postcodeLine(b.id)}
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
                </>,
              ),
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
  const listQuery = nc ? tree : map;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <Network className="size-7 text-primary" aria-hidden />
          {t("regions.title")}
        </h1>
        {nc && (
          <Button
            data-testid="region-create"
            className="h-11"
            onClick={() => setEditing({ kind: "region", name: "" })}
          >
            <Plus />
            {t("regions.newRegion")}
          </Button>
        )}
      </header>
      <div
        role="group"
        aria-label={t("regions.viewLabel")}
        className="flex flex-wrap gap-1 border-b pb-4"
      >
        {(["map", "list"] as const).map((v) => {
          const Icon = v === "map" ? MapIcon : List;
          return (
            <Button
              key={v}
              data-testid={`regions-view-switch-${v}`}
              variant={view === v ? "secondary" : "ghost"}
              aria-pressed={view === v}
              className="h-11"
              onClick={() => setView(v)}
            >
              <Icon />
              {t(`regions.views.${v}`)}
            </Button>
          );
        })}
      </div>
      {view === "map" ? (
        map.isLoading ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : map.isError ? (
          <p role="alert" className="text-destructive">
            {translateError(map.error)}
          </p>
        ) : (
          <BranchMap
            branches={map.data ?? []}
            fit={nc ? "uk" : "branches"}
            onOpenBranch={(id) => {
              setFocusBranch(id);
              setView("list");
            }}
          />
        )
      ) : listQuery.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : listQuery.isError ? (
        <p role="alert" className="text-destructive">
          {translateError(listQuery.error)}
        </p>
      ) : nc ? (
        ncList
      ) : (
        rdList
      )}
      {editing && (
        <EventDialog
          open
          onClose={() => setEditing(null)}
          title={t(
            editing.kind === "branch" && editing.id
              ? nc
                ? "regions.editBranch"
                : "regions.editLocationTitle"
              : editing.id
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
                readOnly={!nc}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="h-11"
              />
            </div>
            {editing.kind === "branch" && (
              <div className="space-y-1.5">
                <Label htmlFor="branch-form-postcode">{t("regions.postcode")}</Label>
                <Input
                  id="branch-form-postcode"
                  data-testid="branch-form-postcode"
                  value={editing.postcode ?? ""}
                  maxLength={10}
                  autoComplete="postal-code"
                  aria-describedby="branch-form-postcode-help"
                  aria-invalid={postcodeValue === null}
                  onChange={(e) => setEditing({ ...editing, postcode: e.target.value })}
                  className="h-11 uppercase"
                />
                <p
                  id="branch-form-postcode-help"
                  className={`text-sm ${postcodeValue === null ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {t(postcodeValue === null ? "errors.postcodeInvalid" : "regions.postcodeHelp")}
                </p>
              </div>
            )}
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
                disabled={busy || editing.name.trim().length < 2 || postcodeValue === null}
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
