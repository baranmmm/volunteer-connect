// The Leaflet map (loaded lazily, only on Regions & branches): CARTO Positron tiles (OpenStreetMap without a key), one
// keyboard-focusable dot per branch coloured by region (larger when the branch has volunteers); hover, focus or tap
// shows the branch name. Counts appear only in the side panel.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./branch-map.css";
import {
  basemapTiles,
  cartoKey,
  located,
  type MapBranch,
  type RegionColor,
} from "@/lib/branch-map";

/** The first view when no branch has coordinates yet. */
const UK_BOUNDS: L.LatLngBoundsExpression = [
  [49.9, -8.2],
  [58.7, 1.8],
];
/** Branch view: a margin around the outermost markers, and no closer than town level for one or two branches. */
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [40, 40], maxZoom: 10 };
// CARTO Positron on the Lovable domains (the key is restricted to them), OpenStreetMap elsewhere.
const TILES = basemapTiles(
  cartoKey(
    typeof window === "undefined" ? "" : window.location.hostname,
    import.meta.env["VITE_CARTO_BASEMAP_KEY"] as string | undefined,
  ),
);

type Props = {
  branches: MapBranch[];
  colors: Map<string, RegionColor>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function BranchMapView({ branches, colors, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const select = useRef(onSelect);
  select.current = onSelect;
  /** The branch positions the view was last fitted to: a refetch with the same positions keeps the user's zoom. */
  const fitted = useRef<string | null>(null);

  // The map itself, once.
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false, keyboard: true, zoomSnap: 0.25 });
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
    );
    L.tileLayer(TILES.url, {
      maxZoom: 18,
      subdomains: TILES.subdomains,
      attribution: TILES.attribution,
      // Dark mode filters this layer only (not markers, tooltips or controls): branch-map.css.
      className: "branch-map-tiles",
      detectRetina: false,
    }).addTo(m);
    el.current.dataset["basemap"] = TILES.provider;
    m.fitBounds(UK_BOUNDS);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The container may get its size after the first layout (lazy chunk, grid): recompute once it is visible.
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Markers.
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    nodes.current.clear();
    const shown = branches.filter(located);
    for (const b of shown) {
      const color = colors.get(b.region_id);
      const label = t("regions.map.markerLabel", { name: b.name, region: b.region });
      // A plain dot; branches with volunteers get a slightly larger one.
      const size = b.volunteers > 0 ? 20 : 14;
      const icon = L.divIcon({
        className: `branch-map-marker${b.volunteers > 0 ? " has-volunteers" : ""}`,
        html: `<span style="background:${color?.fill ?? "#0072B2"}"></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([b.latitude, b.longitude], {
        icon,
        keyboard: true,
        title: b.name,
        alt: label,
        riseOnHover: true,
      });
      // The name on hover, keyboard focus and tap (the tooltip is not interactive; the list is the full alternative).
      marker.bindTooltip(b.name, {
        direction: "top",
        offset: [0, -size / 2 - 2],
        className: "branch-map-tooltip",
      });
      marker.on("click", () => {
        marker.openTooltip();
        select.current(b.id);
      });
      marker.addTo(group);
      const node = marker.getElement();
      if (node) {
        node.dataset["testid"] = "regions-map-marker";
        node.dataset["branchId"] = b.id;
        node.setAttribute("aria-label", label);
        nodes.current.set(b.id, node);
        node.addEventListener("focus", () => marker.openTooltip());
        node.addEventListener("blur", () => marker.closeTooltip());
        // role="button": Enter and Space choose the branch like a click.
        node.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            select.current(b.id);
          }
        });
      }
    }
    // Opens fitted to the branches it shows (NC: every located branch; RD: their region's), the UK without any.
    const points = shown.map((b) => [b.latitude, b.longitude] as L.LatLngTuple);
    const key = JSON.stringify(points);
    if (fitted.current !== key) {
      fitted.current = key;
      if (points.length) m.fitBounds(L.latLngBounds(points), FIT_OPTIONS);
      else m.fitBounds(UK_BOUNDS);
      // For tests: what the view was fitted to.
      if (el.current) el.current.dataset["fit"] = points.length ? "branches" : "uk";
    }
  }, [branches, colors, t]);

  // The chosen branch (without rebuilding the markers, so keyboard focus stays where it is).
  useEffect(() => {
    for (const [id, node] of nodes.current) {
      node.setAttribute("aria-pressed", String(id === selectedId));
      node.classList.toggle("is-selected", id === selectedId);
    }
  }, [selectedId, branches, colors, t]);

  // Phones: the details open as a bottom sheet over the lower part of the map, so bring the map to the top of the
  // screen and the chosen marker into its upper quarter.
  useEffect(() => {
    const m = map.current;
    const chosen = branches.find((b) => b.id === selectedId);
    if (!m || !el.current || !chosen || !located(chosen)) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    el.current.scrollIntoView({ block: "start", behavior: "smooth" });
    const size = m.getSize();
    const point = m.latLngToContainerPoint([chosen.latitude, chosen.longitude]);
    m.panBy([point.x - size.x / 2, point.y - size.y / 4]);
  }, [selectedId, branches]);

  return (
    <div
      ref={el}
      data-testid="regions-map"
      role="region"
      aria-label={t("regions.map.label")}
      className="branch-map relative z-0 h-[60vh] min-h-[360px] w-full overflow-hidden rounded-2xl border bg-muted"
    />
  );
}
