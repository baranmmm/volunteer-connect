// Playwright webServer command: starts the app's Vite dev server pointed at the QA project.
// Variables already present in the process environment take precedence over the committed
// repo-root .env (production), both for Vite's VITE_* injection and for server functions.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { E2E_EMAIL_LINK_SECRET, e2eCronSecret } from "./email-capture";
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
  // Emails are rendered and stored on the outbox row instead of being sent (no Brevo key needed, nothing leaves).
  EMAIL_TRANSPORT: "capture",
  EMAIL_LINK_SECRET: process.env["EMAIL_LINK_SECRET"]?.trim() || E2E_EMAIL_LINK_SECRET,
  // The scheduled routes (task reminders, cleanup) for tests that trigger them.
  CLEANUP_CRON_SECRET: e2eCronSecret(),
  // Links in emails point at this app server.
  APP_URL: url.origin,
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
