// Web Push configuration shared by the browser and the server. The VAPID public key is public by design (browsers send
// it to the push service when subscribing); the matching private key is the server secret VAPID_PRIVATE_KEY (never
// here, never in a VITE_ variable). `VITE_VAPID_PUBLIC_KEY` overrides the committed default (key rotation: docs/push.md).

/** The committed VAPID public key (base64url, uncompressed P-256 point). */
export const DEFAULT_VAPID_PUBLIC_KEY =
  "BCHm4d1eJa0rlLxOQrkRjfypWCftJ9LMLLc6vdoEwps8noYC7lQ7OLdkk5zBneXBsHrtHIjuXlWjwnIZu4N0M1M";

export const VAPID_PUBLIC_KEY: string =
  (import.meta.env?.["VITE_VAPID_PUBLIC_KEY"] as string | undefined)?.trim() ||
  DEFAULT_VAPID_PUBLIC_KEY;

/** The service worker (public/sw.js) and its scope. */
export const SERVICE_WORKER_URL = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";

/** The installed app's name on the home screen (public/manifest.webmanifest short_name), used in settings help. */
export const APP_SHORT_NAME = "DS Volunteers";
