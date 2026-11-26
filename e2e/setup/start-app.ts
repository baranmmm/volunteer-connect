// Playwright webServer command: starts the app's Vite dev server pointed at the QA project.
// Variables already present in the process environment take precedence over the committed
// repo-root .env (production), both for Vite's VITE_* injection and for server functions.
import { spawn, spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_EMAIL_LINK_SECRET, e2eCronSecret } from "./email-capture";
import { REPO_ROOT, baseUrl, isLocalTarget, requireEnv } from "./env";
import { QA_REF, assertQaEnvironment } from "./guard";

const url = new URL(baseUrl());
const prod = process.env["E2E_APP_BUILD"] === "prod";
const reuseBuild = prod && process.env["E2E_APP_BUILD_SKIP"] === "1";

/**
 * A Web Push (VAPID) key pair made for this app server only, never the production one: pushes are really encrypted,
 * signed and posted (to test endpoints that do not exist). A production build bakes the public key in, so a reused
 * build reuses the pair stored next to it (.output is not committed).
 */
const storedVapid = path.join(REPO_ROOT, ".output", "e2e-vapid-test-keys.json");
function testVapidKeys(): { publicKey: string; privateKey: string } {
  if (reuseBuild && existsSync(storedVapid)) return JSON.parse(readFileSync(storedVapid, "utf8"));
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // getPrivateKey() drops leading zero bytes (about 1 key in 256): a raw P-256 scalar is always 32 bytes.
  const privateKey = Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString("base64url");
  return { publicKey: ecdh.getPublicKey("base64url"), privateKey };
}
const vapid = testVapidKeys();
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
  // The scheduled routes (task reminders, cleanup, the outbox tick) for tests that trigger them.
  SCHEDULED_JOBS_SECRET: e2eCronSecret(),
  // Web Push with a test key pair generated for this server (testVapidKeys).
  VITE_VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:e2e@example.test",
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

// E2E_APP_BUILD=prod: a production build (Nitro node-server preset) instead of the dev server, so a fault that only
// shows in built bundles (chunking, tree shaking, SSR/client split) fails the specs too. E2E_APP_BUILD_SKIP=1 reuses
// an existing .output.
const port = url.port || "3100";
let child;
if (prod) {
  const buildEnv = { ...env, NITRO_PRESET: "node-server" };
  if (!reuseBuild) {
    console.log("[start-app] Building the app (production, node-server preset)...");
    const build = spawnSync(vite, ["build"], { cwd: REPO_ROOT, env: buildEnv, stdio: "inherit" });
    if (build.status) process.exit(build.status);
    mkdirSync(path.dirname(storedVapid), { recursive: true });
    writeFileSync(storedVapid, JSON.stringify(vapid), { mode: 0o600 });
  }
  console.log(`[start-app] Starting the production build on ${url.origin} against ${env["SUPABASE_URL"]}`);
  child = spawn("node", [path.join(REPO_ROOT, ".output", "server", "index.mjs")], {
    cwd: REPO_ROOT,
    env: { ...buildEnv, PORT: port, HOST: url.hostname },
    stdio: "inherit",
  });
} else {
  console.log(`[start-app] Starting app on ${url.origin} against ${env["SUPABASE_URL"]}`);
  child = spawn(vite, ["dev", "--port", port, "--strictPort", ...(process.env["E2E_VITE_FORCE"] === "1" ? ["--force"] : [])], { cwd: REPO_ROOT, env, stdio: "inherit" });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
