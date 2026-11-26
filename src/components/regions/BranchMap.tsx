// The map view of Regions & branches: the lazily loaded Leaflet map, a legend of region colours, and a panel with the
// chosen branch's Branch Managers and numbers (counts only, never volunteer or follower names). The List view is its
// accessible alternative.
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, X } from "lucide-react";
import { located, regionColors, type MapBranch } from "@/lib/branch-map";
import { Button } from "@/components/ui/button";

const BranchMapView = lazy(() => import("./BranchMapView"));

type Props = {
  /** Every branch the viewer may see (NC: all; RD: their region): the map opens fitted to the located ones. */
  branches: MapBranch[];
  onOpenBranch: (id: string) => void;
};

export function BranchMap({ branches, onOpenBranch }: Props) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const colors = useMemo(() => regionColors(branches), [branches]);
  const selected = branches.find((b) => b.id === selectedId) ?? null;
  const unlocated = branches.filter((b) => !located(b));
  const counts = selected
    ? ([
        ["volunteers", selected.volunteers],
        ["trustees", selected.trustees],
        ["followers", selected.followers],
        ["events", selected.upcoming_events],
        ["tasks", selected.open_tasks],
      ] as const)
    : [];
  const color = selected ? colors.get(selected.region_id) : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        <Suspense
          fallback={
            <div className="flex h-[60vh] min-h-[360px] items-center justify-center rounded-2xl border bg-muted text-muted-foreground">
              {t("common.loading")}
            </div>
          }
        >
          <BranchMapView
            branches={branches}
            colors={colors}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
        <ul
          data-testid="regions-map-legend"
          aria-label={t("regions.map.legend")}
          className="flex flex-wrap gap-x-4 gap-y-2 text-sm"
        >
          {[...colors.entries()].map(([id, c]) => (
            <li key={id} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-4 rounded-full border-2 border-background shadow"
                style={{ background: c.fill }}
              />
              {c.name}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t("regions.map.badgeHint")}</p>
        {unlocated.length > 0 && (
          <p data-testid="regions-map-unlocated" className="text-sm text-muted-foreground">
            {t("regions.map.unlocated", { names: unlocated.map((b) => b.name).join(", ") })}
          </p>
        )}
      </div>
      <aside aria-live="polite" aria-label={t("regions.map.panelLabel")} className="min-w-0">
        {selected ? (
          <section
            data-testid="regions-map-panel"
            data-branch-id={selected.id}
            // Phones: a bottom sheet over the map; wide screens: a side panel next to it.
            className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] space-y-4 overflow-y-auto rounded-t-2xl border-t bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.15)] lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-2xl lg:border lg:pb-5 lg:shadow-soft"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{selected.name}</span>
                </h2>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded-full"
                    style={{ background: color?.fill }}
                  />
                  {selected.region}
                  {selected.postcode && <span>· {selected.postcode}</span>}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                data-testid="regions-map-panel-close"
                aria-label={t("regions.map.closePanel")}
                onClick={() => setSelectedId(null)}
              >
                <X />
              </Button>
            </div>
            <div>
              <h3 className="text-sm font-medium">{t("regions.managers")}</h3>
              {selected.managers.length ? (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {selected.managers.map((name) => (
                    <li key={name} data-testid="regions-map-panel-manager">
                      {name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("regions.nobody")}</p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {counts.map(([key, value]) => (
                <div
                  key={key}
                  data-testid={`regions-map-panel-count-${key}`}
                  data-value={value}
                  className="rounded-xl border p-3"
                >
                  <dt className="text-xs text-muted-foreground">
                    {t(`regions.map.counts.${key}`)}
                  </dt>
                  <dd className="text-2xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            <Button
              className="h-11 w-full"
              data-testid="regions-map-panel-open"
              onClick={() => onOpenBranch(selected.id)}
            >
              {t("regions.map.openBranch")}
            </Button>
          </section>
        ) : (
          <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
            {t("regions.map.hint")}
          </p>
        )}
      </aside>
    </div>
  );
}
