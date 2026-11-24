// The Leaflet map (loaded lazily, only on Regions & branches): OpenStreetMap tiles, one keyboard-focusable marker per
// branch coloured by region, with the active volunteer count as its badge.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./branch-map.css";
import { located, type MapBranch, type RegionColor } from "@/lib/branch-map";

const UK_BOUNDS: L.LatLngBoundsExpression = [
  [49.9, -8.2],
  [58.7, 1.8],
];
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

type Props = {
  branches: MapBranch[];
  colors: Map<string, RegionColor>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** "uk": the whole country (NC); "branches": fit to the given branches (RD's region). */
  fit: "uk" | "branches";
};

export default function BranchMapView({ branches, colors, selectedId, onSelect, fit }: Props) {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const select = useRef(onSelect);
  select.current = onSelect;

  // The map itself, once.
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false, keyboard: true, zoomSnap: 0.25 });
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: ATTRIBUTION,
    }).addTo(m);
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
      const label = t("regions.map.markerLabel", {
        name: b.name,
        region: b.region,
        count: b.volunteers,
      });
      const icon = L.divIcon({
        className: "branch-map-marker",
        html: `<span style="background:${color?.fill ?? "#0072B2"};color:${color?.ink ?? "#ffffff"}">${b.volunteers}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = L.marker([b.latitude, b.longitude], {
        icon,
        keyboard: true,
        title: b.name,
        alt: label,
        riseOnHover: true,
      });
      marker.on("click", () => select.current(b.id));
      marker.addTo(group);
      const node = marker.getElement();
      if (node) {
        node.dataset["testid"] = "regions-map-marker";
        node.dataset["branchId"] = b.id;
        node.setAttribute("aria-label", label);
        nodes.current.set(b.id, node);
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
    if (fit === "branches" && shown.length) {
      m.fitBounds(L.latLngBounds(shown.map((b) => [b.latitude, b.longitude])), {
        padding: [40, 40],
        maxZoom: 10,
      });
    }
  }, [branches, colors, fit, t]);

  // The chosen branch (without rebuilding the markers, so keyboard focus stays where it is).
  useEffect(() => {
    for (const [id, node] of nodes.current) {
      node.setAttribute("aria-pressed", String(id === selectedId));
      node.classList.toggle("is-selected", id === selectedId);
    }
  }, [selectedId, branches, colors, fit, t]);

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
