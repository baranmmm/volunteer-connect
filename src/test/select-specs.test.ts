// CI test selection (e2e/scripts/select-specs.mjs): a pull request never gets the full suite automatically.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { estimate, select } from "../../e2e/scripts/select-specs.mjs";

type Selection = {
  mode: string;
  specs: string[];
  grep: string;
  suggestFull: boolean;
  tests: number;
  minutes: number;
};
const pick = (...files: string[]) => select(files) as Selection;

describe("PR e2e test selection", () => {
  it("never selects the full suite, whatever changed", () => {
    for (const file of [
      "e2e/fixtures/roles.ts",
      "e2e/setup/env.ts",
      "e2e/playwright.config.ts",
      "package.json",
      "src/integrations/supabase/client.ts",
    ]) {
      expect(pick(file).mode, file).toBe("selected");
    }
  });

  it("a helper selects the specs importing it, not every spec through the shared fixtures", () => {
    const all = pick("e2e/fixtures/roles.ts").specs.length;
    const page = pick("e2e/pages/EventPage.ts");
    expect(page.specs).toContain("ui/recurring-events");
    expect(page.specs.length).toBeGreaterThan(0);
    expect(page.specs.length).toBeLessThan(all);
  });

  it("files no spec imports select only @smoke", () => {
    for (const file of ["e2e/playwright.config.ts", "e2e/setup/teardown.ts", "docs/tasks.md"]) {
      const result = pick(file);
      expect(result.specs, file).toEqual([]);
      expect(result.grep, file).toBe("@smoke");
    }
  });

  it("build files and the Supabase client suggest the full-ci label", () => {
    expect(pick("package.json").suggestFull).toBe(true);
    expect(pick("src/integrations/supabase/client.ts").suggestFull).toBe(true);
    expect(pick("src/routes/events.index.tsx").suggestFull).toBe(false);
  });

  it("estimates more test runs and minutes for more specs, the most for the full suite", () => {
    const smoke = pick("docs/tasks.md");
    const area = pick("src/routes/events.index.tsx");
    const full = estimate([], true) as { tests: number; minutes: number };
    expect(smoke.tests).toBeGreaterThan(0);
    expect(area.tests).toBeGreaterThan(smoke.tests);
    expect(full.tests).toBeGreaterThan(area.tests);
    expect(full.minutes).toBeGreaterThanOrEqual(area.minutes);
    expect(area.minutes).toBeGreaterThanOrEqual(smoke.minutes);
  });
});
