import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The "/" route (the Join page) must stay light for the dev server and the first visit: its static import graph never
// reaches the events map (components, helpers or the UK dot data). A timeout compiling it in the Lovable preview led
// to keeping the map data out of every module graph (public/maps/uk-dots.svg).
const SRC = path.resolve(__dirname, "..");

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Files reached by static (non-type) imports from `entry`; lazy import() calls are not followed. */
function staticGraph(entry: string) {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    const re =
      /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^"'`;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
    for (const m of code.matchAll(re)) {
      const next = resolve(file, (m[1] ?? m[2])!);
      if (next && /\.(ts|tsx)$/.test(next)) visit(next);
    }
  };
  visit(path.join(SRC, entry));
  return [...seen].map((f) => path.relative(SRC, f));
}

describe("route import graphs", () => {
  it('"/" (Join) imports no events-map code or map data', () => {
    const files = staticGraph("routes/index.tsx");
    expect(files.length).toBeGreaterThan(3);
    expect(
      files.filter((f) => /events-map|events-story|uk-dots|leaflet|branch-map/.test(f)),
    ).toEqual([]);
  });
  it("public routes never reach the install-app code (signed-in only, loaded with the member shell)", () => {
    const publicRoutes = [
      "routes/__root.tsx",
      "routes/index.tsx",
      "routes/events.index.tsx",
      "routes/sign-in.tsx",
      "routes/join.tsx",
      "routes/privacy_.attendees.tsx",
      "routes/_app/route.tsx",
      "routes/_app/events_.$id.tsx",
    ];
    for (const route of publicRoutes) {
      expect(
        staticGraph(route).filter((f) => /install-app|InstallApp/.test(f)),
        route,
      ).toEqual([]);
    }
    // The member shell (a lazy chunk) and the dashboard do load it.
    expect(staticGraph("components/app/MemberShell.tsx")).toContain("lib/install-app-store.ts");
    expect(staticGraph("routes/_app/dashboard.tsx")).toContain("components/app/InstallApp.tsx");
  });
  it("the map data is a static asset, not a module (/events imports only its geometry)", () => {
    const files = staticGraph("routes/events.index.tsx");
    expect(files).toContain("components/public/events-map/uk-dots.ts");
    expect(
      readFileSync(path.join(SRC, "components/public/events-map/uk-dots.ts"), "utf8").length,
    ).toBeLessThan(2000);
  });
});
