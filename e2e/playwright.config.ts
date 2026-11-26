import { defineConfig, devices } from "@playwright/test";
import { baseUrl, isLocalTarget } from "./setup/env";
import { assertQaEnvironment } from "./setup/guard";
import { outputDirs } from "./setup/output-dirs";

// Abort before anything starts if the environment is not unambiguously QA.
assertQaEnvironment();

const CI = !!process.env["CI"];
const BASE_URL = baseUrl();
const { outputDir, reportDir } = outputDirs(CI);

export default defineConfig({
  testDir: "./tests",
  // Local stack: one session at a time (setup/local-lock.ts).
  ...(isLocalTarget() ? { globalSetup: "./setup/local-lock.global.ts" } : {}),
  outputDir,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // CI runs 3 shards at once against the shared QA database: one worker each keeps it under its limits.
  workers: CI ? 1 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // CI runs in shards: each writes a blob report and the workflow merges them into one HTML report.
  // setup/redact-reporter.ts comes first: it masks passwords in step titles, errors and attachment files (traces,
  // error-context) before the other reporters copy them.
  reporter: CI
    ? [["./setup/redact-reporter.ts"], ["list"], ["blob"]]
    : [["./setup/redact-reporter.ts"], ["list"], ["html", { open: "never", outputFolder: reportDir }]],
  use: {
    baseURL: BASE_URL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testDir: "./setup", testMatch: /auth\.setup\.ts/ },
    // Warms the dev server up (signed-out and signed-in pages) so dependency re-optimisation reloads happen before the
    // UI tests (setup/warmup.setup.ts).
    { name: "warmup", testDir: "./setup", testMatch: /warmup\.setup\.ts/, dependencies: ["setup"] },
    { name: "desktop-chromium", testMatch: /ui\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["warmup"] },
    { name: "mobile-pixel7", testMatch: /ui\/.*\.spec\.ts/, use: { ...devices["Pixel 7"] }, dependencies: ["warmup"] },
    // Browser-independent permission checks run once.
    { name: "api", testMatch: /api\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: "npx tsx setup/start-app.ts",
    url: BASE_URL,
    // Never reuse an already running server: it might be pointed at production.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
