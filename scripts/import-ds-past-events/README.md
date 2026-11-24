# Import Dialogue Society past events

A one-time import that fills the public "Past events" gallery and the "Highlights" videos with recent activity from
the Dialogue Society website, so the landing page does not start empty.

## What it does

1. **Events.** Walks the public archive at <https://www.dialoguesociety.org/events/> (newest first, page by page) and
   opens each linked event page. It picks events dated before today (Europe/London) that have at least 3 usable photos
   (gallery photos first, otherwise the featured image plus the images in the text), and stops at 15 (`--limit`).
   Duplicates (same page, or same title and date) are skipped.
2. **Photos.** 3–6 per event, spread over the gallery. For each photo it downloads the smallest published size whose
   long side reaches 1920 px (never the 5000 px originals), then re-encodes it to WebP (quality 80, max 1920 px long
   side, EXIF orientation applied, all metadata stripped) and uploads it to the private `event-media` bucket as
   `<event id>/<media id>.webp`. Each `event_media` row has `kind = image`, `in_gallery = true`, `source_url` = the
   original photo URL on the site, the WebP `width`/`height` and `original_name`.
3. **Event rows** (inserted directly with the service role, which `validate_event` allows for `past_record` rows):
   title, a short description, organizer "Dialogue Society", category `other`, `status = published`,
   `audience = public`, all-day on the event date (`start_date = end_date`), registration off, `past_record = true`,
   `created_by = NULL`. The site's branch badge is matched to a `branches` row by name (case-insensitive); with no match
   (for example the region badge "Greater London") the record is national (`scope = national`, no branch).
4. **Descriptions** are generated from the page's facts, not copied: who hosted it, what kind of event, venue and date,
   whether it was free and open to all, plus up to three topic words taken from the page text. At most 2 sentences and
   300 characters; deterministic, so re-runs produce the same text.
5. **Highlights.** The latest 6 videos from the channel feed
   (`https://www.youtube.com/feeds/videos.xml?channel_id=UC4flSkjv9m4IvU3jwsi0ecw`) become `event_videos` rows with
   `event_id = NULL` (links only). The poster `https://i.ytimg.com/vi/<id>/hqdefault.jpg` is re-encoded and stored as
   `videos/<video id>.jpg` (`thumb_path`); `created_at` is the YouTube publish time so the landing order matches the
   channel.

### Politeness

Only the public HTML pages are read. The WordPress REST API (`/wp-json/`, disallowed in the site's `robots.txt`) is
never used. Requests are sequential with at least 1 second between them, use a descriptive User-Agent without personal
data, and every page and image is cached on disk (`--cache-dir`, default `<os tmp>/ds-past-events-import-cache`), so a
re-run makes no requests at all. `--refresh` ignores the cache.

### Idempotency

An imported event is recognised by the `source_url` of its photos (the marker), or else by a past record with the same
title and date. Existing events are left alone; only photos that are missing (by `source_url`, up to 6) are added, so a
run that failed half-way can simply be repeated. `--update-text` also rewrites the description of existing records
(off by default so later edits in the app are kept). Videos are recognised by the `(event_id NULL, youtube_id)` unique
index; a missing poster is added on a re-run. If a new event ends up with fewer than 3 photos, its files are removed
from Storage first and then its rows.

## Run it locally

The local stack must be running (`docker ps` shows `supabase_*_dsvh-e2e-local`; otherwise `cd e2e && npm run local:up`).
The script reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `e2e/.env.local` (the default local keys written
by `local:up`) and refuses any host that is not `127.0.0.1`/`localhost`. Keys are never printed.

```sh
# Plan only: parse the site, show what would be imported, no writes.
npx tsx scripts/import-ds-past-events/import.ts --local --dry-run

# Import (run it twice: the second run must report 0 new events, 0 uploaded photos and 0 new videos).
npx tsx scripts/import-ds-past-events/import.ts --local
```

Options: `--limit <n>` (events, default 15), `--videos <n>` (default 6), `--max-pages <n>` (archive pages to walk,
default 8), `--cache-dir <dir>`, `--refresh`, `--update-text`, `--dry-run`.

The output lists the counts (events, photos, videos, skipped pages, database totals before and after), then
`date | branch | title | photos | source URL | status`, the generated descriptions, the videos and the skipped pages
with the reason.

## Production (later, only with the user's approval)

Production is **not** run from this repo by default. It needs the production service role key, which only the user
holds (GitHub secrets). Only after the user says "import prod", the lead runs it either from the user's machine or
from a one-off `workflow_dispatch` job that has the secrets:

```sh
# 1. Always dry-run first and review the list with the user.
IMPORT_PROD_CONFIRM=yes SUPABASE_URL=<prod url> SUPABASE_SERVICE_ROLE_KEY=<from secrets> \
  npx tsx scripts/import-ds-past-events/import.ts --prod --dry-run
# 2. Then the real run (idempotent: safe to repeat).
IMPORT_PROD_CONFIRM=yes SUPABASE_URL=<prod url> SUPABASE_SERVICE_ROLE_KEY=<from secrets> \
  npx tsx scripts/import-ds-past-events/import.ts --prod
```

Without `--prod` the script refuses any non-local URL and refuses to run if the production project ref appears
anywhere in the environment; `--prod` without `IMPORT_PROD_CONFIRM=yes` also refuses. The production database must
already have the public events v2 migrations (`20261130090000`, `20261130090100`) applied through the
`PROD DB migrate` workflow.

To undo an import, delete the imported past events in the app (they go through the Recycle Bin, which removes their
files). For the channel highlights (`event_videos` with `event_id IS NULL`), remove the poster object through the
Storage API first and then the row. Never delete Storage objects with SQL.
