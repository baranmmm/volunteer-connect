// Web Push on this device: whether the browser can do it, the state shown in Profile > Notifications, the short device
// label stored with a subscription, and when the dashboard card asks. Pure functions only (src/test/web-push.test.ts);
// the browser calls live in src/lib/push/client.ts. Signed-in code only: no public route imports it.

/** What this browser offers. */
export type PushEnvironment = {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** Inside a frame of another origin (e.g. the Lovable preview): registration and the permission prompt are refused. */
  crossOriginFrame: boolean;
  ios: boolean;
  standalone: boolean;
};

/**
 * `ios-install`: iPhone / iPad outside the installed app (Safari offers Web Push only to home-screen apps, iOS 16.4+);
 * `unsupported`: no service worker / Push API / Notification, or a cross-origin frame.
 */
export type PushSupport = "supported" | "unsupported" | "ios-install";

export function pushSupport(env: PushEnvironment): PushSupport {
  if (env.crossOriginFrame) return "unsupported";
  if (env.ios && !env.standalone) return "ios-install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  return "supported";
}

/** The state of push on this device. */
export type PushDeviceState = "unsupported" | "ios-install" | "denied" | "off" | "on";

export function pushDeviceState(
  support: PushSupport,
  permission: NotificationPermission | null,
  subscribed: boolean,
): PushDeviceState {
  if (support !== "supported") return support;
  if (permission === "denied") return "denied";
  return subscribed && permission === "granted" ? "on" : "off";
}

/** A short label such as "Chrome on Android" (no version, nothing identifying), at most 60 characters. */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  const ua = userAgent || "";
  const os = /iPhone|iPod/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Macintosh|Mac OS X/i.test(ua)
              ? "Mac"
              : /Linux/i.test(ua)
                ? "Linux"
                : null;
  const browser = /EdgA?\/|EdgiOS/i.test(ua)
    ? "Edge"
    : /SamsungBrowser/i.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/i.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS/i.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS|Chromium/i.test(ua)
            ? "Chrome"
            : /Safari\//i.test(ua)
              ? "Safari"
              : null;
  const label = browser && os ? `${browser} on ${os}` : (browser ?? os ?? "Browser");
  return label.slice(0, 60);
}

/** Whether a subscription was made with this application server key (else: subscribe again, e.g. after a rotation). */
export function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current) return true; // the browser does not expose it: assume it is ours
  const bytes = new Uint8Array(current);
  if (bytes.length !== expected.length) return false;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== expected[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Dashboard card (installed app only): "Turn on notifications". Shown while push is off on this device; "Not now"
// hides it, it comes back once after 7 days, and after a second "Not now" never again (Profile stays the place).
// Denied: the card explains how to allow notifications in the phone's settings (also dismissible with "Not now").

export const PUSH_PROMPT_KEY = "push-prompt-dismissals";
export const PUSH_PROMPT_SNOOZE_MS = 7 * 24 * 3600 * 1000;

export type PushPromptMemory = { dismissals: number; lastDismissedAt: number | null };
export type PushPromptMode = "ask" | "denied";

/** Storage that may be missing or throw (private mode, blocked site data). */
type MaybeStorage = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function readPushPromptMemory(storage: MaybeStorage): PushPromptMemory {
  try {
    const raw = storage?.getItem(PUSH_PROMPT_KEY);
    if (!raw) return { dismissals: 0, lastDismissedAt: null };
    const parsed = JSON.parse(raw) as { n?: unknown; at?: unknown };
    const n = typeof parsed.n === "number" && parsed.n > 0 ? Math.floor(parsed.n) : 0;
    const at = typeof parsed.at === "number" && Number.isFinite(parsed.at) ? parsed.at : null;
    return { dismissals: n, lastDismissedAt: at };
  } catch {
    return { dismissals: 0, lastDismissedAt: null };
  }
}

/** Records one "Not now"; returns the new memory (kept for this page when storage is unavailable). */
export function recordPushPromptDismissal(
  storage: MaybeStorage,
  memory: PushPromptMemory,
  now: number,
): PushPromptMemory {
  const next = { dismissals: memory.dismissals + 1, lastDismissedAt: now };
  try {
    storage?.setItem(PUSH_PROMPT_KEY, JSON.stringify({ n: next.dismissals, at: now }));
  } catch {
    /* storage unavailable: remembered for this page only */
  }
  return next;
}

/** The dashboard card: only in the installed app, only while push is off (or blocked) here, within the dismissal rules. */
export function pushPromptMode(input: {
  standalone: boolean;
  state: PushDeviceState | null;
  memory: PushPromptMemory;
  now: number;
}): PushPromptMode | null {
  if (!input.standalone) return null;
  if (input.state !== "off" && input.state !== "denied") return null;
  const { dismissals, lastDismissedAt } = input.memory;
  if (dismissals >= 2) return null;
  if (
    dismissals === 1 &&
    lastDismissedAt !== null &&
    input.now - lastDismissedAt < PUSH_PROMPT_SNOOZE_MS
  )
    return null;
  return input.state === "denied" ? "denied" : "ask";
}

/** Which "allow notifications again" steps to show. */
export type PushSettingsHelp = "ios" | "android" | "desktop";
export const pushSettingsHelp = (platform: { ios: boolean; android: boolean }): PushSettingsHelp =>
  platform.ios ? "ios" : platform.android ? "android" : "desktop";
