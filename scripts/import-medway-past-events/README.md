# Import Medway past events

A one-off import of Medway's own past events with photos the branch chose, so the Medway pilot starts with its
history in the public "Past events" gallery, the event pages and the Media tab. Modelled on
`scripts/import-ds-past-events` (same photo processing), but it reads a prepared folder on disk instead of a website.

## Input (prepared by hand, not in the repo)

A folder (default `~/Downloads/ds-media/selected`, `--dir` to change) with:

- `events.json`: an array of `{ "folder", "title", "date": "YYYY-MM-DD", "venue" }` (optional `"description"` to
  replace the generated text). Dates are London calendar dates and must be in the past.
- One sub-folder per event with exactly `01.jpg` … `12.jpg`, in display order; `01.jpg` is the cover. Only these
  twelve names are read (any other file is listed as ignored); a missing file, an unreadable image or the same file
  twice anywhere stops the run before anything is written.

## What it writes

1. **Event rows** (service role, which `validate_event` allows for `past_record` rows): branch Medway (scope `branch`,
   its region), category `other`, audience `public`, `status = published`, all-day on the date
   (`start_date = end_date`), registration off, `past_record = true`, organizer "Dialogue Society Medway", location =
   the venue (in person), `created_by` = the Medway Branch Manager account.
2. **Description**, generated from the facts only (no people's names), at most 2 sentences and 300 characters:
   "Dialogue Society Medway held its *title* at *venue* on *date*." plus one neutral sentence for the kind of event
   (iftar, Christmas dinner, International Women's Day iftar, walk for peace) taken from the title.
3. **Photos**, the same processing as the DS import: re-encoded to WebP (quality 80, max 1920 px long side, EXIF
   orientation applied, all metadata stripped), stored in the private `event-media` bucket as
   `<event id>/<media id>.webp` with the 640/1280 px copies (`scripts/backfill-image-copies/copies.ts`,
   `has_variants = true`; if a copy fails the photo stays with `has_variants = false` for the backfill). One
   `event_media` row per file: `kind = image`, `position` = file order (0 = `01.jpg`, so it is the cover: the first
   image by position), `in_gallery = true`, `original_name` = `01.jpg` …, `uploaded_by = NULL` (imported),
   `content_hash` = SHA-256 of the chosen JPEG (as the app's upload sets it, so the Media duplicate check also knows
   these photos), WebP `width`/`height`. 12 is also the app's cap for a past record (`add_event_media`).

`created_by`: `--created-by <email>` names the account; it must be an active Branch Manager whose branch is Medway.
Without it (local only) the script uses the only active Medway BM and refuses if there are none or several. The run
prints the account's name and id, never the email or a key.

## Idempotency

An event is found again by its photos' `content_hash` on a live Medway past record, or else by a Medway past record
with the same title and date; it is then left as it is (`--update-text` rewrites its description). Only files whose
hash is missing on that event are uploaded, never above 12 files per event, so a run that stopped half-way is simply
repeated. A new record whose cover (`01.jpg`) could not be stored is removed again (Storage files first, then rows).

## Run it locally

The local stack must be running (`cd e2e && npm run local:up`). Keys come from `e2e/.env.local` (`--local-env` to use
another worktree's file); any host other than `127.0.0.1`/`localhost` is refused, as is a production ref anywhere in
the environment. A writing local run takes the machine-wide local-stack lock (`e2e/setup/local-lock.ts`) and refuses
while another session's e2e run holds it.

```sh
npx tsx scripts/import-medway-past-events/import.ts --local --dry-run   # plan only, no writes
npx tsx scripts/import-medway-past-events/import.ts --local             # twice: the 2nd run must add 0
```

The imported rows change the Medway gallery that e2e specs count: run `npm run local:reset && npm run local:seed`
(in `e2e/`) before Playwright afterwards.

## Production (only by the user, in their own terminal)

The production service role key is never written to a file, the shell history or the repo, and never shown to
Claude: it is read with `read -s` into the current shell only. Run from a clean checkout of `main` (with
`bun install`), with the prepared folder in place. Always a dry run first.

```sh
read -s "SUPABASE_SERVICE_ROLE_KEY?Production service role key: "; echo
export SUPABASE_SERVICE_ROLE_KEY
export SUPABASE_URL=https://kcxmjscxooqqhsgrhknb.supabase.co IMPORT_PROD_CONFIRM=yes
npx tsx scripts/import-medway-past-events/import.ts --prod --created-by '<Medway BM email>' --dry-run
npx tsx scripts/import-medway-past-events/import.ts --prod --created-by '<Medway BM email>'
npx tsx scripts/import-medway-past-events/import.ts --prod --created-by '<Medway BM email>'   # expect 0 uploaded
unset SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL IMPORT_PROD_CONFIRM
```

`--prod` needs `IMPORT_PROD_CONFIRM=yes` and `--created-by`, and refuses a local URL.

To undo, delete the records in the app (they go through the Recycle Bin, which removes their files). Never delete
Storage objects with SQL.
