# Backfill resized image copies

Event images (covers and gallery photos) have two resized WebP copies next to the original in the event's folder of
the private `event-media` bucket: `<path without extension>.w640.webp` and `.w1280.webp` (long side at most 640 and
1280 px, never upscaled). The public pages (landing, `/events/:id`) use them through `srcset`/`sizes`; a row's
`event_media.has_variants` says the copies exist (see the migration `20261203090000_public_perf_branch_map.sql`).

New uploads get their copies in the browser (`src/lib/event-files.ts`) and the past-events import makes them too. This
script adds the copies for every image stored before that.

## What it does

For every `event_media` row with `kind = image` and `has_variants = false` (keyset paging by id):

1. Checks through the Storage API that the original exists. An image of an archived event (its files are under
   `deleted/`) is skipped and counted as "original not stored"; run the script again after a restore.
2. When both copies are already stored, only sets `has_variants = true`.
3. Otherwise downloads the original with the service role, makes both copies with sharp (EXIF orientation applied,
   WebP quality 78, no metadata, no upscaling), uploads the missing ones (`upsert: false`; a copy that is already
   stored is kept) and sets `has_variants = true` (and the original's `width`/`height` when they were empty).

It is idempotent: a second run finds nothing to do. Storage objects are only written and checked through the Storage
API, never with SQL. It prints counts only (plus the media id of a row that failed), never keys.

## Run it locally

The local stack must be running (`cd e2e && npm run local:up`). The script reads `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` from `e2e/.env.local` (the default local keys) and refuses any host that is not
`127.0.0.1`/`localhost`, and refuses to run if the production project ref appears anywhere in the environment.

```sh
npx tsx scripts/backfill-image-copies/backfill.ts --local --dry-run   # counts only, no writes
npx tsx scripts/backfill-image-copies/backfill.ts --local             # then once more: 0 checked
```

Options: `--dry-run`, `--limit <n>` (rows to check, for a trial run).

Output: total images and how many have copies before and after, then the rows checked — copies created, copies
already stored (flag set only), planned (dry run), original not stored, failed. Any failure sets exit code 1; the
script can simply be run again.

## Production (later, only with the user's approval)

Only after the user says so, and after the migration `20261203090000_public_perf_branch_map.sql` has reached
production through the `PROD DB migrate` workflow. It needs the production service role key, which only the user holds:

```sh
# 1. Dry run first.
IMPORT_PROD_CONFIRM=yes SUPABASE_URL=<prod url> SUPABASE_SERVICE_ROLE_KEY=<from secrets> \
  npx tsx scripts/backfill-image-copies/backfill.ts --prod --dry-run
# 2. The real run (idempotent: safe to repeat).
IMPORT_PROD_CONFIRM=yes SUPABASE_URL=<prod url> SUPABASE_SERVICE_ROLE_KEY=<from secrets> \
  npx tsx scripts/backfill-image-copies/backfill.ts --prod
```

`--prod` without `IMPORT_PROD_CONFIRM=yes` refuses, and so does a production URL without `--prod`.
