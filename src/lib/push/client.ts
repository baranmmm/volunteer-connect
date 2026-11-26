// Web Push in the browser (signed-in code only; public routes never import it, src/test/route-imports.test.ts). The
// service worker (public/sw.js, scope /) is registered only when the member turns push on, never on page load, and
// never on public pages. Everything fails quietly: a browser without the Push API, a cross-origin frame (the Lovable
// preview) or a refused registration simply shows push as unavailable.
// One store per page (useSyncExternalStore) so the dashboard card and Profile > Notifications agree.
import { useEffect, useSyncExternalStore } from "react";
import { classifyPlatform, isStandalone } from "@/lib/install-app";
import {
  listMyPushSubscriptions,
  registerPushSubscription,
  unregisterPushSubscription,
} from "@/lib/push.functions";
import { base64urlDecode } from "./base64url";
import { SERVICE_WORKER_SCOPE, SERVICE_WORKER_URL, VAPID_PUBLIC_KEY } from "./config";
import {
  deviceLabel,
  pushDeviceState,
  pushSupport,
  sameKey,
  type PushDeviceState,
  type PushEnvironment,
} from "./support";

const READY_TIMEOUT_MS = 10000;

function crossOriginFrame(): boolean {
  try {
    return window.top !== window.self && window.top!.location.origin !== window.location.origin;
  } catch {
    return true; // reading the parent's location throws across origins
  }
}

/** The browser's capabilities and platform (no permission prompt, no registration). */
export function pushEnvironment(): PushEnvironment & { android: boolean } {
  if (typeof window === "undefined")
    return {
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotification: false,
      crossOriginFrame: false,
      ios: false,
      android: false,
      standalone: false,
    };
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const platform = classifyPlatform(nav.userAgent, nav.maxTouchPoints ?? 0);
  return {
    hasServiceWorker: "serviceWorker" in nav && !!nav.serviceWorker,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    crossOriginFrame: crossOriginFrame(),
    ios: platform.ios,
    android: platform.android,
    standalone: isStandalone(window.matchMedia?.bind(window), nav.standalone),
  };
}

const permission = (): NotificationPermission | null => {
  try {
    return "Notification" in window ? Notification.permission : null;
  } catch {
    return null;
  }
};

async function existingSubscription(): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

function target(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) throw new Error("Invalid push subscription");
  return { endpoint: json.endpoint, p256dh, auth };
}

const label = () => deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0);

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: SERVICE_WORKER_SCOPE,
    updateViaCache: "none",
  });
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("service_worker_timeout")), READY_TIMEOUT_MS),
    ),
  ]);
}

/** This browser's subscription with our key (an older key's subscription is replaced, e.g. after a key rotation). */
async function subscribeWithOurKey(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const key = base64urlDecode(VAPID_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  return (
    subscription ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Store

type State = {
  /** null until the first check has run. */
  device: PushDeviceState | null;
  busy: boolean;
  /** This browser's endpoint while push is on (marks "this device" in the list). */
  endpoint: string | null;
};
let state: State = { device: null, busy: false, endpoint: null };
let checked: Promise<void> | null = null;
let synced = false;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Reads the state for this device (no prompt); once per page, then again on demand. */
export function refreshPushState(): Promise<void> {
  checked = (async () => {
    const env = pushEnvironment();
    const support = pushSupport(env);
    if (support !== "supported") return set({ device: support, endpoint: null });
    const subscription = await existingSubscription();
    const device = pushDeviceState(support, permission(), !!subscription);
    set({ device, endpoint: device === "on" ? (subscription?.endpoint ?? null) : null });
    // Keep the server in step once per page: a device the server removed (gone, reset) or a rotated key is
    // registered again without asking (permission is already granted).
    if (device === "on" && subscription && !synced) {
      synced = true;
      try {
        const registration = await navigator.serviceWorker.ready;
        const current = await subscribeWithOurKey(registration);
        await registerPushSubscription({ data: { ...target(current), label: label() } });
        if (current.endpoint !== subscription.endpoint) set({ endpoint: current.endpoint });
      } catch {
        /* try again on the next page load */
      }
    }
  })().catch(() => set({ device: "unsupported", endpoint: null }));
  return checked;
}

export type EnableResult = "on" | "denied" | "dismissed" | "failed";

/**
 * Turns push on for this device. Call it straight from a click handler: the permission request is the first thing it
 * does (browsers allow the prompt only during a user gesture). Then the service worker, the subscription and the server.
 */
export function enablePush(): Promise<EnableResult> {
  let asked: Promise<NotificationPermission>;
  try {
    asked =
      Notification.permission === "granted"
        ? Promise.resolve("granted")
        : Promise.resolve(Notification.requestPermission());
  } catch {
    return Promise.resolve("failed");
  }
  set({ busy: true });
  return (async (): Promise<EnableResult> => {
    let subscription: PushSubscription | null = null;
    try {
      const answer = await asked;
      if (answer === "denied") {
        set({ device: "denied" });
        return "denied";
      }
      if (answer !== "granted") return "dismissed";
      const registration = await readyRegistration();
      subscription = await subscribeWithOurKey(registration);
      await registerPushSubscription({ data: { ...target(subscription), label: label() } });
      synced = true;
      set({ device: "on", endpoint: subscription.endpoint });
      return "on";
    } catch {
      // The server did not take it: leave the browser unsubscribed too, so both agree.
      await subscription?.unsubscribe().catch(() => false);
      return "failed";
    } finally {
      set({ busy: false });
    }
  })();
}

/** Turns push off for this device (browser and server). */
export async function disablePush(): Promise<boolean> {
  set({ busy: true });
  try {
    const subscription = await existingSubscription();
    if (subscription) {
      await unregisterPushSubscription({ data: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe().catch(() => false);
    }
    set({ device: pushDeviceState("supported", permission(), false), endpoint: null });
    return true;
  } catch {
    return false;
  } finally {
    set({ busy: false });
  }
}

/** Removes another of my devices (by id). */
export const removePushDevice = (id: string) => unregisterPushSubscription({ data: { id } });

/** My devices (labels only), this one marked. */
export const listPushDevices = () =>
  listMyPushSubscriptions({ data: state.endpoint ? { endpoint: state.endpoint } : {} });

/**
 * Before signing out: this browser stops receiving the member's pushes (server row and browser subscription), so the
 * next person on a shared device never sees them. Bounded to a few seconds; never throws.
 */
export async function forgetPushDevice(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const work = (async () => {
    const subscription = await existingSubscription();
    if (!subscription) return;
    await unregisterPushSubscription({ data: { endpoint: subscription.endpoint } }).catch(
      () => undefined,
    );
    await subscription.unsubscribe().catch(() => false);
  })();
  await Promise.race([work.catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  synced = false;
  set({ device: null, endpoint: null });
  checked = null;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

export function usePushState(): State {
  useEffect(() => {
    if (!checked) void refreshPushState();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
