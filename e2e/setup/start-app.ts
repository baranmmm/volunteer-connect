// Playwright webServer command: starts the app's Vite dev server pointed at the QA project.
// Variables already present in the process environment take precedence over the committed
// repo-root .env (production), both for Vite's VITE_* injection and for server functions.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, baseUrl, isLocalTarget, requireEnv } from "./env";
import { QA_REF, assertQaEnvironment } from "./guard";

const url = new URL(baseUrl());
const projectId = isLocalTarget() ? "local" : QA_REF;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  SUPABASE_URL: requireEnv("SUPABASE_URL"),
  SUPABASE_PUBLISHABLE_KEY: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
  SUPABASE_PROJECT_ID: projectId,
  // Server-only: used by the deleteUser server function. Never prefixed with VITE_.
  SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  VITE_SUPABASE_URL: requireEnv("SUPABASE_URL"),
  VITE_SUPABASE_PUBLISHABLE_KEY: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
  VITE_SUPABASE_PROJECT_ID: projectId,
};

try {
  assertQaEnvironment(env);
} catch (e) {
  console.error((e as Error).message);
  console.error("[start-app] The app server was NOT started.");
  process.exit(1);
}

const vite = path.join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
if (!existsSync(vite)) {
  console.error("[start-app] App dependencies are missing. Run `bun install` in the repository root first.");
  process.exit(1);
}

console.log(`[start-app] Starting app on ${url.origin} against ${env["SUPABASE_URL"]}`);
const child = spawn(vite, ["dev", "--port", url.port || "3100", "--strictPort"], { cwd: REPO_ROOT, env, stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
