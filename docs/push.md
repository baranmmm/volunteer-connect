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
| The outbox tick (pushes and emails every minute) | `src/lib/outbox-flush.server.ts`, `src/routes/api/public/outbox-flush.ts`, `supabase/migrations/20261213090000_outbox_flush_cron.sql` |
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
  member action (`flushNoticeEmails()` also flushes push) and, as the backstop, from the **outbox tick** within a
  minute (pg_cron job `outbox-flush`, below; also the "Task reminders" run). Rows waiting longer than a day expire;
  finished rows are deleted after 7 days.
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
| `SCHEDULED_JOBS_SECRET` | Lovable secret (server only) | The bearer secret of the scheduled routes (`/api/public/outbox-flush`, `/api/public/task-reminders`, `/api/public/cleanup-deleted-events`; `src/lib/scheduled-jobs.server.ts`). The same value in Supabase Vault (`scheduled_jobs_secret`) and the GitHub secret. Unset or empty: every call is refused (401). |

Without `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` nothing is sent: rows wait (and expire after a day), and every flush
while pushes are waiting logs `[push] vapid problem=missing: …`.

### Creating a key pair

Any P-256 tool works; for example with Node (prints the two values; store the private one as the secret and put the
public one in `src/lib/push/config.ts` or `VITE_VAPID_PUBLIC_KEY`, never commit the private one):

```sh
node -e "const c=require('crypto').createECDH('prime256v1');c.generateKeys();console.log('public ',c.getPublicKey('base64url'));console.log('private',c.getPrivateKey('base64url'))"
```

### Self-check

On first use in each server isolate (Workers have no long-lived start-up) the server derives the public point from
`VAPID_PRIVATE_KEY` and compares it with the public key. On a mismatch (or a malformed key or subject) nothing is sent
until it is fixed, and every flush with pushes waiting logs one line naming the problem, never either key:
`[push] vapid problem=mismatch: Web Push disabled: VAPID_PRIVATE_KEY does not match VITE_VAPID_PUBLIC_KEY …`. Only a
passing check is cached per isolate; a failing one is repeated on the next flush, so a fixed secret works without a
restart. Tested in `src/test/web-push.test.ts` and `src/test/outbox-flush.test.ts`.

### Rotating the keys

1. Create a new pair. 2. Set the new `VAPID_PRIVATE_KEY` in Lovable and the new public key in
`src/lib/push/config.ts` (or `VITE_VAPID_PUBLIC_KEY`) and publish both together (the self-check refuses to send while
they disagree). 3. Existing subscriptions were made with the old key and are refused by the push services: on the next
app load each browser sees the different key, subscribes again with the new one (permission is already granted) and
re-registers. Devices that do not open the app again stop receiving pushes; their rows go when the push service answers
404/410.

## Production setup / troubleshooting

### The outbox tick (every minute)

pg_cron job **`outbox-flush`** (`* * * * *`) runs `public.outbox_flush_tick()`. When work is due
(`public.outbox_flush_due()`: a pending push whose `not_before` has passed, a pending email while the London day's
limit has room, or a claim older than 5 / 15 minutes) and both Vault secrets exist, it POSTs
`<app_url>/api/public/outbox-flush` with `Authorization: Bearer <scheduled_jobs_secret>` through pg_net
(asynchronous, 25 s timeout). Otherwise it does nothing; it never raises. The route sends the waiting pushes
(`flushPush`, trigger `cron`) and the email outbox of every priority (`docs/email.md`), each part about 10 s, and
answers only counts:

```json
{ "vapid": "ok", "pushes_claimed": 1, "pushes_sent": 1, "pushes_gone": 0, "pushes_retried": 0, "pushes_failed": 0,
  "email": "ok", "emails_sent": 0, "emails_skipped": 0, "emails_failed": 0 }
```

`vapid` is `ok` or the problem code (`missing`, `invalid_private_key`, `invalid_public_key`, `invalid_subject`,
`mismatch`); `email` is `ok` or `not_configured` (no Brevo key: no email is claimed). A wrong or missing secret gets an
empty 401. The GitHub workflows ("Task reminders", "Cleanup Recycle Bin") stay as fallbacks with the same secret.

### One-time setup (production)

1. **Make the secret** on your own computer (never paste it into a chat, a log, a ticket or the repo):
   `openssl rand -base64 32`
2. **Lovable → Project Settings → Secrets**: add `SCHEDULED_JOBS_SECRET` with that value. Check `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT` are there too (the private half of the public key in `src/lib/push/config.ts`). Publish the app.
3. **GitHub → Settings → Secrets and variables → Actions → New repository secret**: `SCHEDULED_JOBS_SECRET`, the same
   value (the fallback workflows; the old `CLEANUP_CRON_SECRET` is no longer read and can be deleted).
4. **Supabase → SQL editor** (production), the same value and the published app URL:

   ```sql
   select vault.create_secret('<the same value>', 'scheduled_jobs_secret');
   select vault.create_secret('https://ds-volunteer.lovable.app', 'app_url');
   ```

5. **Verify** (a minute after something was queued, e.g. a task assigned to someone with push on):

   ```sql
   select jobname, schedule, active from cron.job;            -- outbox-flush | * * * * * | true
   select status_code, created from net._http_response order by created desc limit 5;   -- 200s
   select status, attempts, last_error, created_at from public.push_outbox order by created_at desc limit 5;
   ```

   `net._http_response` rows appear only for minutes with due work. 401: the Vault and Lovable values differ (or the
   app was not published after adding the secret); 404: `app_url` is wrong; no rows at all while pushes wait: a Vault
   secret is missing (check `select name from vault.decrypted_secrets;`, never select the value into a shared screen).

**Rotating the secret**: make a new value, set it in Lovable (publish) and GitHub, then in the SQL editor:

```sql
select vault.update_secret((select id from vault.secrets where name = 'scheduled_jobs_secret'), '<new value>');
```

Calls between the publish and the Vault update get 401 and are retried by the next minute's tick.

### Log lines (Lovable server logs)

| Line | Meaning |
| --- | --- |
| `[push] flush trigger=<post-action\|cron\|reminders> vapid=<ok\|problem> claimed=N sent=N gone=N retry=N failed=N` | One per flush (a member action, the tick, the "Task reminders" run). Silent only when the keys are unusable and nothing waits. |
| `[push] attempt outbox=<push_outbox id> kind=<kind> attempt=<n> result=<sent\|gone\|retry\|failed> http=<status\|network\|invalid_subscription\|deferred>` | One per send. `gone` (404/410 or an unusable device key): the device was removed. `retry`: 429/5xx/network, tried again after 2 × attempts minutes (failed after 5). `403` usually means the VAPID key does not match the one the device subscribed with. |
| `[push] vapid problem=<code>: <message>` | The keys are unusable (missing, malformed, or not a pair) while pushes wait; nothing is claimed. Fix the Lovable secrets and publish. |
| `[push] claim failed: code=<code> <message>` / `[push] finish failed outbox=<id>: …` / `[push] flush error: …` | A database or runtime error; rows stay queued for the next minute. |
| `[email] flush skipped: BREVO_API_KEY or EMAIL_FROM not set` | The tick found no email sender; emails stay pending, untouched. |
| `[email] post-action flush failed: …` / `[push] post-action flush failed: …` | A sender could not even load after a member action; the tick sends the rows. |

The lines never contain endpoints, keys, user ids, email addresses or notification content (long tokens in error
messages are replaced by `[redacted]`).

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
