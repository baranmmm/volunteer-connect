import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

// The branch map (get_branch_map): NC (aal2) every branch, RD their region's. Counts only, never member names;
// managers are the Branch Managers' names.
export const mapBranch = z.object({
  id: z.string().uuid(),
  name: z.string(),
  region_id: z.string().uuid(),
  region: z.string(),
  postcode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  managers: z.array(z.string()),
  volunteers: z.number(),
  followers: z.number(),
  upcoming_events: z.number(),
  open_tasks: z.number(),
});
export type MapBranch = z.infer<typeof mapBranch>;

export async function fetchBranchMap() {
  const { data, error } = await supabase.rpc("get_branch_map");
  if (error) throw error;
  return z.array(mapBranch).parse(data);
}

export function useBranchMap(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["branch-map", userId],
    queryFn: fetchBranchMap,
    enabled: enabled && !!userId,
    staleTime: 60_000,
  });
}

/** Okabe-Ito: distinguishable with common colour-vision deficiencies; `ink` is the readable text colour on it. */
export const REGION_PALETTE = [
  { fill: "#0072B2", ink: "#ffffff" },
  { fill: "#E69F00", ink: "#000000" },
  { fill: "#009E73", ink: "#000000" },
  { fill: "#CC79A7", ink: "#000000" },
  { fill: "#56B4E9", ink: "#000000" },
  { fill: "#D55E00", ink: "#000000" },
  { fill: "#F0E442", ink: "#000000" },
  { fill: "#000000", ink: "#ffffff" },
] as const;

export type RegionColor = { name: string; fill: string; ink: string };

/** Region id → colour, by region name order (stable for the same set of regions). */
export function regionColors(branches: Pick<MapBranch, "region_id" | "region">[]) {
  const regions = [...new Map(branches.map((b) => [b.region_id, b.region])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  return new Map<string, RegionColor>(
    regions.map(([id, name], i) => [id, { name, ...REGION_PALETTE[i % REGION_PALETTE.length]! }]),
  );
}

/** Branches that can be drawn (both coordinates set). */
export const located = (b: MapBranch): b is MapBranch & { latitude: number; longitude: number } =>
  b.latitude != null && b.longitude != null;

/**
 * The postcode as set_branch_postcode stores it ("SW1A 1AA"): "" for none, null when it is not a UK postcode shape.
 * Convenience only; the database checks the same rule.
 */
export function normalisePostcode(value: string): string | null {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!compact) return "";
  if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export type RegionsView = "map" | "list";
const VIEW_KEY = "regions-view";
export function readRegionsView(): RegionsView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "map";
  } catch {
    return "map";
  }
}
export function saveRegionsView(view: RegionsView) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* storage unavailable */
  }
}
