# Push notifications (Web Push)

Push is the third notice channel next to "In the app" and "Email" (`docs/notifications.md`). It uses the browsers' own
push services (Google FCM, Mozilla, Apple, Microsoft) with the open Web Push standards, so there is no extra account,
SDK or cost. Everything runs on Web Crypto (Cloudflare Workers compatible; no Node-only library such as `web-push`).

## Pieces

| Piece | Where |
| --- | --- |
| Service worker: `push` and `notificationclick` only. No fetch handler, no cache, no precache, so it never serves a stale app. `SW_VERSION` constant, `skipWaiting()` + `clients.claim()`, scope `/` | `public/sw.js` |
| Browser side: support check, the service worker registration (only when a member turns push on), subscribe / unsubscribe, one store per page | `src/lib/push/client.ts`, rules in `src/lib/push/support.ts` |
| UI: Profile > Notifications (one On/Off switch for this device at the top; the Push column per type and the other devices in Advanced settings), the dashboard card in the installed app | `src/components/app/PushNotifications.tsx`, `src/components/app/NotificationSettings.tsx` |
| Database: `push_subscriptions`, `push_outbox`, the RPCs, the queueing in `notify()` | `supabase/migrations/20261212090000_web_push.sql` |
| Encryption (RFC 8291, `aes128gcm`) and VAPID (RFC 8292, ES256 JWT) | `src/lib/push/webpush.ts` |
| The VAPID key check | `src/lib/push/vapid.server.ts`, `src/lib/push/p256.ts` |
| The sender | `src/lib/push/sender.server.ts` |
| What a push shows | `src/lib/push/payload.ts`, `push.*` in `src/locales/{en,tr}.json` |

Public routes never load any of it (`src/test/route-imports.test.ts`); the service worker is never registered on page
load or on public pages.

## Opting in (never on page load)

- **Profile > Notifications**: "Phone notifications (push)", one On/Off switch for this device (on asks for
  permission from the click and registers this device; off unregisters it). In Advanced settings: a **Push** checkbox
  per type (the member's setting, independent of this device) and the member's other devices (label such as "Chrome on
  Android", Remove).
- **Dashboard card, installed app only** (`push-prompt`): "Turn on notifications to hear about your tasks" with one
  button that asks for permission from the click itself. It stays until push is on or "Not now"; after a first "Not
  now" it comes back once after 7 days, after the second never again (Profile stays). Remembered per device
  (`localStorage` key `push-prompt-dismissals`; works without storage). Followers never see it (no notices).
  It never shows together with the Install app banner: the card needs the installed app, the banner a browser tab;
  the card comes first at the top of the dashboard.
- **Blocked** (permission denied): the card and Profile explain how to allow notifications again: iPhone/iPad
  (Settings > Notifications > DS Volunteers > Allow Notifications), Android (touch and hold the app icon > App info >
  Notifications, or the browser's site settings), computers (site settings next to the address bar).
- **iPhone / iPad**: Safari offers Web Push only to the installed app (iOS 16.4 or later): outside it Profile shows
  that message instead of the switch.
- **Unavailable**: no service worker / Push API / Notification, a cross-origin frame (the Lovable preview) or a failed
  registration: shown as unavailable, never an error.
- **Sign-out** removes this browser's subscription (server and browser) first, so the next person on a shared device
  never gets the previous member's pushes. The same browser turned on by another member moves to them, and the
  previous owner's waiting pushes for it are dropped.

## What is sent, and when

- Same types and switches as email; push defaults **on** for `task_assigned` (incl. task groups), `review` and
  `meeting`, **off** for every other type. Every kind of a type that is on is pushed at once (also the ones whose email
  waits for the daily summary); the grouped review notice when it is created or its count goes up.
- `notify()` / `review_notice_refresh()` queue one `push_outbox` row per device; the server sends them right after the
  member action (`flushNoticeEmails()` also flushes push) and in the scheduled run (`/api/public/task-reminders`) as a
  backstop. Rows waiting longer than a day expire; finished rows are deleted after 7 days.
- **Content (no sensitive details)**: a generic title per kind ("New task for you", "New meeting invitation",
  "Requests are waiting for your review") and a generic line ("Open the Volunteer Hub to see it.", the number of
  requests for the review notice), in the member's language. Never the item's title, a name, a place or a link to an
  online meeting. Clicking opens the related page (focuses an open window of the app, else opens one).
- Results: 2xx sent (`last_used_at` updated); **404/410: the subscription is deleted**; 429/5xx/network: retried with
  back-off (failed after 5 attempts); other answers: failed. Logs never contain endpoints, keys or content.

## Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `VITE_VAPID_PUBLIC_KEY` | build (optional) | The public key browsers subscribe with. The committed default lives in `src/lib/push/config.ts`; set this only to override it. Public by design. |
| `VAPID_PRIVATE_KEY` | Lovable secret (server only) | base64url raw 32-byte P-256 private scalar matching the public key. Never in a `VITE_*` variable or the repo. |
| `VAPID_SUBJECT` | Lovable secret (server only) | Contact for the push services: `mailto:medway@dialoguesociety.org` (or an `https:` URL). |

Without `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` nothing is sent (one warning in the log; rows wait and expire).

### Creating a key pair

Any P-256 tool works; for example with Node (prints the two values; store the private one as the secret and put the
public one in `src/lib/push/config.ts` or `VITE_VAPID_PUBLIC_KEY`, never commit the private one):

```sh
node -e "const c=require('crypto').createECDH('prime256v1');c.generateKeys();console.log('public ',c.getPublicKey('base64url'));console.log('private',c.getPrivateKey('base64url'))"
```

### Self-check

On first use in each server isolate (Workers have no long-lived start-up) the server derives the public point from
`VAPID_PRIVATE_KEY` and compares it with the public key. On a mismatch (or a malformed key or subject) it logs one clear
error naming the problem, never either key, and sends nothing until it is fixed: "Web Push disabled:
VAPID_PRIVATE_KEY does not match VITE_VAPID_PUBLIC_KEY …". Tested in `src/test/web-push.test.ts`.

### Rotating the keys

1. Create a new pair. 2. Set the new `VAPID_PRIVATE_KEY` in Lovable and the new public key in
`src/lib/push/config.ts` (or `VITE_VAPID_PUBLIC_KEY`) and publish both together (the self-check refuses to send while
they disagree). 3. Existing subscriptions were made with the old key and are refused by the push services: on the next
app load each browser sees the different key, subscribes again with the new one (permission is already granted) and
re-registers. Devices that do not open the app again stop receiving pushes; their rows go when the push service answers
404/410.

## Data and privacy

- `push_subscriptions` (endpoint, the two keys, a short device label, created / last used) belongs to its member:
  `user_id` → `profiles` ON DELETE CASCADE (it means nothing without them), and a soft delete removes the member's
  devices at once. At most 10 devices per member.
- No table access for anon or authenticated (National Coordinators included); only the own-row RPCs
  `register_push_subscription`, `unregister_push_subscription`, `list_my_push_subscriptions` (labels and dates, never
  endpoints or keys) and `set_notification_push`. The sender uses the service-role-only `claim_push_batch` and
  `finish_push`.
- The pre-launch reset deletes every push row except the kept NC's own devices (`scripts/prelaunch/reset.sql`).

## Test ids

`profile-push` (`data-state` `loading` / `unsupported` / `ios-install` / `denied` / `off` / `on`),
`profile-push-switch` (shown only for `loading` / `off` / `on`), `profile-push-unsupported`,
`profile-push-ios-install`, `profile-push-denied`, `profile-push-denied-help` (`data-platform`); in Advanced settings
`profile-push-device` (`data-device-id`), `profile-push-device-remove`, `profile-notification-push` (and `data-push` on
`profile-notification-row`); dashboard card `push-prompt` (`data-mode` `ask` / `denied`), `push-prompt-enable`,
`push-prompt-not-now`, `push-prompt-help` (`data-platform`).
