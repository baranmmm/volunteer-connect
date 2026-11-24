// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// Never set ssr.external or resolve.external: the Worker has no runtime module resolution, so
// the build fails. Never add compression (compressPublicAssets, vite-plugin-compression):
// hosting already compresses at the edge.
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    // Dev server only: scan every route for dependencies at startup. Without it Vite discovers a lazily loaded
    // route's dependencies on its first visit, re-optimises them and force-reloads every open page ("optimized
    // dependencies changed. reloading"), which aborted in-flight requests and broke e2e runs on a cold cache.
    // `include` lists what hydrating a server-rendered page imports from inside TanStack's own (unscanned) packages.
    // Discovered only at run time, they caused that same reload; where the reload does not reach the page (Lovable's
    // preview holds it), the page kept running with two copies of React and i18next: an error page, dead buttons
    // and raw translation keys. Check the dev log for "new dependencies optimized" after framework upgrades.
    optimizeDeps: {
      entries: ["src/router.tsx", "src/routes/**/*.tsx", "src/components/**/*.tsx"],
      include: [
        "@tanstack/history",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "@tanstack/router-core/ssr/server",
        "h3-v2",
        "seroval",
      ],
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
