// Basemap tiles shared by the Leaflet maps (Regions & branches, the public events map). No imports: safe in any chunk.

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION}, © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`;

/**
 * The CARTO basemap key: public and referer-restricted to Lovable's domains (*.lovable.app, *.lovableproject.com,
 * lovable.dev), so it is not a secret. It is used only when the page is served from one of those domains — elsewhere
 * (local dev, e2e) CARTO refuses it and the map uses the OpenStreetMap tiles. VITE_CARTO_BASEMAP_KEY overrides it.
 */
export const CARTO_PUBLIC_KEY = "cb1_5f7m_1_d38212198bd936a3d7e4b91c";
const CARTO_HOSTS = [/\.lovable\.app$/, /\.lovableproject\.com$/, /(^|\.)lovable\.dev$/];

/** The CARTO key for this page: the env override, else the public key on an allowed host, else none (OSM). */
export function cartoKey(hostname: string, envKey: string | undefined): string | undefined {
  const own = envKey?.trim();
  if (own) return own;
  return CARTO_HOSTS.some((h) => h.test(hostname.toLowerCase())) ? CARTO_PUBLIC_KEY : undefined;
}

export type BasemapTiles = {
  url: string;
  subdomains: string;
  attribution: string;
  provider: "carto" | "osm";
};

/**
 * The basemap: CARTO Positron (light, retina tiles) with the public, domain-restricted key from
 * VITE_CARTO_BASEMAP_KEY; without a key, the OpenStreetMap standard tiles. Dark mode reuses the same tiles with a CSS
 * filter on the tile layer only (branch-map.css).
 */
export function basemapTiles(key: string | undefined): BasemapTiles {
  const k = key?.trim();
  if (!k)
    return {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: "abc",
      attribution: OSM_ATTRIBUTION,
      provider: "osm",
    };
  return {
    // CARTO's raster endpoint with the key as the `key` query parameter (keyless requests get "API KEY REQUIRED"
    // tiles); {r} = "@2x" on retina screens.
    url: `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(k)}`,
    subdomains: "",
    attribution: CARTO_ATTRIBUTION,
    provider: "carto",
  };
}

/** The basemap for this page: CARTO Positron on the Lovable domains (the key is restricted to them), else OSM. */
export function pageBasemapTiles(): BasemapTiles {
  return basemapTiles(
    cartoKey(
      typeof window === "undefined" ? "" : window.location.hostname,
      import.meta.env["VITE_CARTO_BASEMAP_KEY"] as string | undefined,
    ),
  );
}
