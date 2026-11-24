// The interactive events map (a lazy chunk: Leaflet loads only after the static preview, when the page is idle or the
// section is on screen). One keyboard-focusable marker per place; the card is drawn by the parent (EventsMap).
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./events-map.css";
import { pageBasemapTiles } from "@/lib/map-tiles";
import { placeBounds } from "@/lib/events-map";
import { UK_BOUNDS } from "./uk-outline";
import type { LabelledPlace } from "./types";

const TILES = pageBasemapTiles();
export const FIT_PADDING = 40;
export const FIT_MAX_ZOOM = 11;

type Props = {
  places: LabelledPlace[];
  /** Event ids hovered or focused in the list: their markers are emphasised. */
  highlightIds: ReadonlySet<string>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  reducedMotion: boolean;
  label: string;
};

function fit(m: L.Map, bounds: L.LatLngBoundsExpression, animate: boolean) {
  const size = m.getSize();
  if (!size.x || !size.y) return;
  m.fitBounds(bounds, {
    padding: [FIT_PADDING, FIT_PADDING],
    maxZoom: FIT_MAX_ZOOM,
    animate,
  });
}

export default function EventsLeafletMap({
  places,
  highlightIds,
  selectedKey,
  onSelect,
  reducedMotion,
  label,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const select = useRef(onSelect);
  select.current = onSelect;
  const fitted = useRef<string | null>(null);
  const bounds = useRef<L.LatLngBoundsExpression>(UK_BOUNDS);
  const motion = useRef(!reducedMotion);
  motion.current = !reducedMotion;

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
      className: "events-map-tiles",
      detectRetina: false,
    }).addTo(m);
    el.current.dataset["basemap"] = TILES.provider;
    // A view is needed before markers can be added; the real fit follows below.
    m.fitBounds(UK_BOUNDS);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The container may get its size after the first layout (lazy chunk, dialog): fit again once it has one.
    let sized = false;
    const resize = new ResizeObserver(() => {
      m.invalidateSize();
      const size = m.getSize();
      if (!sized && size.x > 0 && size.y > 0) {
        sized = true;
        fit(m, bounds.current, false);
      }
    });
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Markers, and the view fitted to them whenever the set of places changes.
  useEffect(() => {
    const m = map.current,
      group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    nodes.current.clear();
    for (const p of places) {
      const count = p.events.length;
      const size = p.kind === "past" ? 18 : 24;
      const icon = L.divIcon({
        className: `events-map-marker is-${p.kind}`,
        html: `<span class="events-map-dot"></span>${count > 1 ? `<span class="events-map-count" aria-hidden="true">${count}</span>` : ""}`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([p.latitude, p.longitude], {
        icon,
        keyboard: true,
        title: p.label,
        alt: p.label,
        riseOnHover: true,
        zIndexOffset: p.kind === "past" ? 0 : 500,
      });
      marker.on("click", () => select.current(p.key));
      marker.addTo(group);
      const node = marker.getElement();
      if (node) {
        node.dataset["testid"] = "events-map-marker";
        node.dataset["placeKey"] = p.key;
        node.dataset["kind"] = p.kind;
        node.dataset["eventIds"] = p.events.map((e) => e.id).join(",");
        node.setAttribute("role", "button");
        node.setAttribute("aria-label", p.label);
        node.removeAttribute("title");
        nodes.current.set(p.key, node);
        node.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            select.current(p.key);
          }
        });
      }
    }
    const signature = places
      .map((p) => p.key)
      .sort()
      .join("|");
    if (fitted.current === signature) return;
    fitted.current = signature;
    bounds.current = placeBounds(places) ?? UK_BOUNDS;
    fit(m, bounds.current, motion.current);
  }, [places]);

  // Highlight and selection without rebuilding the markers (keyboard focus stays put).
  useEffect(() => {
    for (const p of places) {
      const node = nodes.current.get(p.key);
      if (!node) continue;
      const hot = p.events.some((e) => highlightIds.has(e.id));
      node.classList.toggle("is-highlighted", hot);
      node.classList.toggle("is-selected", p.key === selectedKey);
      node.setAttribute("aria-pressed", String(p.key === selectedKey));
      if (hot || p.key === selectedKey) node.style.zIndex = "10000";
      else node.style.zIndex = "";
    }
  }, [places, highlightIds, selectedKey]);

  // Keep the chosen place in view: on phones the card is a bottom sheet, so the marker moves to the upper quarter;
  // elsewhere the map pans only when the marker is off screen.
  useEffect(() => {
    const m = map.current;
    const p = places.find((x) => x.key === selectedKey);
    if (!m || !p) return;
    const point = m.latLngToContainerPoint([p.latitude, p.longitude]);
    const size = m.getSize();
    if (window.matchMedia?.("(max-width: 1023px)").matches)
      m.panBy([point.x - size.x / 2, point.y - size.y / 4], { animate: motion.current });
    else if (point.x < 24 || point.y < 24 || point.x > size.x - 24 || point.y > size.y - 24)
      m.panTo([p.latitude, p.longitude], { animate: motion.current });
  }, [selectedKey, places]);

  return (
    <div
      ref={el}
      data-testid="events-map-leaflet"
      role="region"
      aria-label={label}
      className="events-map-leaflet absolute inset-0 z-0"
    />
  );
}
