import type { Page } from "@playwright/test";
import { randomInt } from "node:crypto";

/**
 * Gives this page its own client IP for the signed-out forms' per-IP rate limits (5 registrations per 10 minutes):
 * the local app server has no Cloudflare in front, so it reads x-forwarded-for. Without this every test of every
 * worker would share one "unknown" bucket. Only the app's server function calls get the header.
 */
export async function useOwnClientIp(page: Page): Promise<string> {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  await page.route("**/_serverFn/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  );
  return ip;
}
