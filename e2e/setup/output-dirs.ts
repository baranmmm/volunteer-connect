// Where Playwright writes traces/screenshots (outputDir) and the HTML report.
// CI: the fixed ./test-results and ./playwright-report (the workflow uploads playwright-report as is).
// Local: one sub-folder per run, so a later run never wipes the traces of an earlier one; sub-folders older
// than 7 days are removed when a new local run starts.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const RESULTS_ROOT = resolve(import.meta.dirname, "..", "test-results");
export const REPORT_ROOT = resolve(import.meta.dirname, "..", "playwright-report");
const KEEP_DAYS = 7;

/** Removes entries of `root` last modified more than KEEP_DAYS ago. */
export function pruneOld(root: string, now = Date.now()): string[] {
  let names: string[];
  try { names = readdirSync(root); } catch { return []; }
  const removed: string[] = [];
  for (const name of names) {
    const path = join(root, name);
    try {
      if (now - statSync(path).mtimeMs > KEEP_DAYS * 86_400_000) { rmSync(path, { recursive: true, force: true }); removed.push(name); }
    } catch { /* gone or unreadable: skip */ }
  }
  return removed;
}

export function outputDirs(ci: boolean) {
  if (ci) return { outputDir: RESULTS_ROOT, reportDir: REPORT_ROOT };
  // The main process picks the tag once; workers inherit it through the environment, so all use one folder.
  const isWorker = process.env["TEST_WORKER_INDEX"] !== undefined;
  if (!process.env["E2E_OUTPUT_TAG"]) {
    const tag = process.env["E2E_RUN_ID"] || `local-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    process.env["E2E_OUTPUT_TAG"] = tag.replace(/[^A-Za-z0-9._-]/g, "_");
  }
  const tag = process.env["E2E_OUTPUT_TAG"]!;
  if (!isWorker && !process.env["E2E_OUTPUT_PRUNED"]) {
    process.env["E2E_OUTPUT_PRUNED"] = "1";
    pruneOld(RESULTS_ROOT);
    pruneOld(REPORT_ROOT);
  }
  return { outputDir: join(RESULTS_ROOT, tag), reportDir: join(REPORT_ROOT, tag) };
}
