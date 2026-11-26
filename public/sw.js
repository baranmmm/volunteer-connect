// Dialogue Society Volunteer Hub: push notifications only (docs/push.md). Deliberately minimal: no fetch handler, no
// cache, no precache, so it can never serve a stale app; every page load goes to the network as without it. Registered
// only when a signed-in member turns push on (src/lib/push/client.ts), scope "/". Bump SW_VERSION on every change so
// browsers install the new file (it is fetched without the HTTP cache: updateViaCache "none").
const SW_VERSION = "2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** A path in this app (same origin); anything else opens the notifications page. */
function appUrl(path) {
  try {
    const url = new URL(
      typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
        ? path
        : "/notifications",
      self.location.origin,
    );
    return url.origin === self.location.origin
      ? url.href
      : new URL("/notifications", self.location.origin).href;
  } catch {
    return new URL("/notifications", self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title =
    typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Dialogue Society";
  const options = {
    body: typeof data.body === "string" ? data.body.slice(0, 300) : "",
    // Full-colour app icon (192x192). The badge is the status-bar icon: Android draws only its alpha channel, so it is
    // a white silhouette on transparent (public/brand/push-badge.svg); an opaque image shows as a white square.
    icon: "/push-icon.png",
    badge: "/push-badge.png",
    data: { url: appUrl(data.url), v: SW_VERSION },
  };
  if (typeof data.tag === "string" && data.tag) {
    options.tag = data.tag.slice(0, 64);
    options.renotify = true;
  }
  if (data.lang === "en" || data.lang === "tr") options.lang = data.lang;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // An open window of the app: focus it and go to the item there.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const focused = await client.focus();
          if (client.url !== target && "navigate" in focused) await focused.navigate(target);
          return;
        } catch {
          /* not focusable or not navigable: open a new window below */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
