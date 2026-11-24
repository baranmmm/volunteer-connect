// National Coordinator dashboard: a small branch map (dots drawn in SVG, no map library or tiles) that opens
// Regions & branches. Leaflet itself loads only on that page.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { located, regionColors, useBranchMap } from "@/lib/branch-map";

// The UK, roughly: longitude scaled by cos(54°) so the shape is not stretched.
const WEST = -8.2;
const EAST = 1.8;
const NORTH = 58.7;
const SOUTH = 49.9;
const SCALE = Math.cos((54 * Math.PI) / 180);
const WIDTH = (EAST - WEST) * SCALE;
const HEIGHT = NORTH - SOUTH;

export function BranchMapCard() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const map = useBranchMap(session?.user.id, true);
  const branches = map.data ?? [];
  const colors = regionColors(branches);
  return (
    <Link
      to="/regions"
      data-testid="dashboard-branch-map-card"
      className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-28 w-20 shrink-0 rounded-lg bg-muted"
        aria-hidden
      >
        {branches.filter(located).map((b) => (
          <circle
            key={b.id}
            cx={(b.longitude - WEST) * SCALE}
            cy={NORTH - b.latitude}
            r={0.16}
            fill={colors.get(b.region_id)?.fill}
            stroke="#ffffff"
            strokeWidth={0.04}
          />
        ))}
      </svg>
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2 font-semibold">
          <MapIcon className="size-4 text-primary" aria-hidden />
          {t("regions.map.dashboardTitle")}
        </p>
        {map.data && (
          <p className="text-sm text-muted-foreground">
            {t("regions.map.dashboardText", { count: branches.length, regions: colors.size })}
          </p>
        )}
        <p className="text-sm font-medium text-primary">{t("regions.map.dashboardOpen")}</p>
      </div>
    </Link>
  );
}
