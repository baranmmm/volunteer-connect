// Web Push fakes for UI specs (docs/push.md): an init script replaces Notification, PushManager and
// navigator.serviceWorker with fakes that record what the app does (window.__push), and can emulate the installed app
// by answering "(display-mode: standalone)". The subscription the app registers with the server is real.
import type { Page } from "@playwright/test";

export type FakePush = {
  /** Notification.permission before any request. */
  permission: NotificationPermission;
  /** What requestPermission() answers. */
  answer?: NotificationPermission;
  standalone?: boolean;
};

/** Installs the fakes before any app code runs (every navigation of the page). */
export async function fakePush(page: Page, cfg: FakePush) {
  await page.addInitScript((cfg: FakePush) => {
    type Sub = {
      endpoint: string;
      options: { applicationServerKey: ArrayBuffer | null };
      toJSON: () => unknown;
      unsubscribe: () => Promise<boolean>;
    };
    const w = window as unknown as Window & {
      __push: {
        permission: NotificationPermission;
        requested: number;
        requestedWithGesture: boolean | null;
        registered: string[];
        subscribed: Sub | null;
        subscribeCalls: number;
        unsubscribed: number;
      };
    };
    w.__push = {
      permission: cfg.permission,
      requested: 0,
      requestedWithGesture: null,
      registered: [],
      subscribed: null,
      subscribeCalls: 0,
      unsubscribed: 0,
    };
    if (cfg.standalone) {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query.includes("display-mode: standalone")
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addListener: () => undefined,
              removeListener: () => undefined,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              dispatchEvent: () => false,
            } as MediaQueryList)
          : original(query);
    }
    const b64 = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    class FakeNotification {
      static get permission() {
        return w.__push.permission;
      }
      static requestPermission() {
        w.__push.requested++;
        w.__push.requestedWithGesture =
          (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? null;
        w.__push.permission = cfg.answer ?? "granted";
        return Promise.resolve(w.__push.permission);
      }
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true, writable: true });
    Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true, writable: true });
    const pushManager = {
      getSubscription: () => Promise.resolve(w.__push.subscribed),
      subscribe: () => {
        w.__push.subscribeCalls++;
        const endpoint = `https://push.example.test/e2e/${b64(random(12))}`;
        const keys = { p256dh: b64(new Uint8Array([4, ...random(64)])), auth: b64(random(16)) };
        const sub: Sub = {
          endpoint,
          options: { applicationServerKey: null },
          toJSON: () => ({ endpoint, keys }),
          unsubscribe: () => {
            w.__push.subscribed = null;
            w.__push.unsubscribed++;
            return Promise.resolve(true);
          },
        };
        w.__push.subscribed = sub;
        return Promise.resolve(sub);
      },
    };
    const registration = { scope: `${location.origin}/`, pushManager };
    const container = {
      register: (url: string) => {
        w.__push.registered.push(url);
        return Promise.resolve(registration);
      },
      getRegistration: () => Promise.resolve(w.__push.registered.length ? registration : undefined),
      ready: Promise.resolve(registration),
      controller: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  }, cfg);
}

/** What the app did with the fakes. */
export const fake = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __push: Record<string, unknown> }).__push;
    return {
      requested: p["requested"] as number,
      requestedWithGesture: p["requestedWithGesture"] as boolean | null,
      registered: p["registered"] as string[],
      subscribeCalls: p["subscribeCalls"] as number,
      endpoint: (p["subscribed"] as { endpoint: string } | null)?.endpoint ?? null,
    };
  });
