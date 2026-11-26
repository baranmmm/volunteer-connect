# England and Wales dot map

Generates the halftone dots of England and Wales for the public events map (`/events`):

- `public/maps/england-wales-dots.svg`: the dots, a static asset the page shows as an image. It stays out of the JS
  module graph and the server-rendered HTML (a 30 KB generated module slowed the dev server's compiles and the page
  chunk).
- `src/components/public/events-map/england-wales-dots.ts`: only the geometry (land bounds, the SVG's box, URL).

Nothing is fetched from the network at run time or during the app build; both generated files are committed, so
Lovable and CI builds need no network.

## Source

[Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0 map units (public domain, no attribution required),
features `SU_A3 = ENG` and `WLS`:

```
curl -sSL -o ne_50m_admin_0_map_units.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson
```

The committed output was generated from the file with SHA-256
`b8d421aca6e9e08e8cdf09cc26af111cc3e0deba4fe915611d58ade71e8a4db0` (natural-earth-vector, latest release v5.1.2).

## Regenerate

```
node scripts/england-wales-map/generate.mjs <path to ne_50m_admin_0_map_units.geojson>
```

The script is deterministic (same input, same output). The projection in it must match `project()` in
`src/lib/events-story.ts` (Vitest checks that London falls inside the dotted bounds).

The map frame is fixed: England and Wales plus a margin, extended once (by `mapFrame`) if a branch ever lies outside
them. It never zooms, pans or re-centres on an event.
