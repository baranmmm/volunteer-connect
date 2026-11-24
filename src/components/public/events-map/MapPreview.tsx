// The static map preview: a coarse UK outline with one dot per place, fitted to the places like the interactive map
// will be. No Leaflet, no tiles, no network: it paints with the page and is replaced by the Leaflet map later.
import { placeBounds, type MarkerKind } from "@/lib/events-map";
import { OUTLINE_PATHS, UK_BOUNDS, svgPoint } from "./uk-outline";

const FILL: Record<MarkerKind, string> = { event: "#006d9c", tba: "#ffffff", past: "#6b7280" };

/** The SVG viewBox around the places (with room around them, at least about a region's size). */
export function previewViewBox(places: { latitude: number; longitude: number }[]) {
  const b = placeBounds(places) ?? UK_BOUNDS;
  const [x1, y1] = svgPoint(b[1][0], b[0][1]);
  const [x2, y2] = svgPoint(b[0][0], b[1][1]);
  const min = 30; // about 1.7 degrees of longitude
  const w = Math.max(x2 - x1, min),
    h = Math.max(y2 - y1, min);
  const cx = (x1 + x2) / 2,
    cy = (y1 + y2) / 2;
  const pw = w * 1.35,
    ph = h * 1.35;
  return { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
}

export function MapPreview({
  places,
  dots = true,
}: {
  places: { key: string; latitude: number; longitude: number; kind: MarkerKind }[];
  /** False once the interactive map is up (its markers replace the dots). */
  dots?: boolean;
}) {
  const vb = previewViewBox(places);
  const r = Math.max(vb.w, vb.h) / 45;
  return (
    <svg
      data-testid="events-map-preview"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      className="absolute inset-0 h-full w-full bg-[#dbe8f0] dark:bg-[#2b3340]"
    >
      {OUTLINE_PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          className="fill-[#f8f6f2] stroke-[#9fb3c2] dark:fill-[#3b4556] dark:stroke-[#56657a]"
          strokeWidth={r / 4}
          strokeLinejoin="round"
        />
      ))}
      {dots &&
        places.map((p) => {
          const [x, y] = svgPoint(p.latitude, p.longitude);
          return (
            <circle
              key={p.key}
              data-testid="events-map-preview-dot"
              cx={x}
              cy={y}
              r={p.kind === "past" ? r * 0.75 : r}
              fill={FILL[p.kind]}
              stroke={p.kind === "tba" ? "#b45309" : "#ffffff"}
              strokeWidth={r / 2.5}
              strokeDasharray={p.kind === "tba" ? `${r / 2} ${r / 3}` : undefined}
            />
          );
        })}
    </svg>
  );
}
