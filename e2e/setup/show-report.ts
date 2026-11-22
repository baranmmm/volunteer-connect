// `npm run report`: opens the newest local run's HTML report (or the CI-style flat report).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPORT_ROOT } from "./output-dirs";

const runs = (existsSync(REPORT_ROOT) ? readdirSync(REPORT_ROOT) : [])
  .map((name) => join(REPORT_ROOT, name))
  .filter((dir) => existsSync(join(dir, "index.html")))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const dir = process.argv[2] ? join(REPORT_ROOT, process.argv[2]) : (runs[0] ?? REPORT_ROOT);
console.log(`Report: ${dir}`);
process.exit(spawnSync("npx", ["playwright", "show-report", dir], { stdio: "inherit" }).status ?? 1);
