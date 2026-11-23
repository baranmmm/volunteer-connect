import { defineConfig, devices } from "@playwright/test";
import { baseUrl } from "./setup/env";
import { assertQaEnvironment } from "./setup/guard";
import { outputDirs } from "./setup/output-dirs";

// Abort before anything starts if the environment is not unambiguously QA.
assertQaEnvironment();

const CI = !!process.env["CI"];
const BASE_URL = baseUrl();
const { outputDir, reportDir } = outputDirs(CI);

export default defineConfig({
  testDir: "./tests",
  outputDir,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // CI runs 3 shards at once against the shared QA database: one worker each keeps it under its limits.
  workers: CI ? 1 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // CI runs in shards: each writes a blob report and the workflow merges them into one HTML report.
  reporter: CI ? [["list"], ["blob"]] : [["list"], ["html", { open: "never", outputFolder: reportDir }]],
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
    { name: "desktop-chromium", testMatch: /ui\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile-pixel7", testMatch: /ui\/.*\.spec\.ts/, use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
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
