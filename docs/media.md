# Media tab

The members-only photo gallery of a branch (`/media`). Migration: `20261216090000_media_library.sql`; code:
`src/lib/media*.ts`, `src/components/media/`, `src/routes/_app/media.tsx`.

## What it shows
- One gallery per branch, filtered in the database (`can_view_media`): the branch's volunteers, trustees and Branch
  Manager, and the region's Regional Directors (they switch between the region's branches). Followers and National
  Coordinators see nothing. Other branches' events and albums never appear, public ones included.
- **Chapters**, newest first: the branch's own events (scope `branch`, published or cancelled, not meetings) with their
  event page photos (`event_media`, still added in the event form) and their Media-only photos, plus the branch's
  **albums** (title, optional date and description, cover: set by a manager, default the first photo).
- Volunteers and trustees get only the 640/1280 px WebP copies of album and Media-only photos (Storage policy); the
  full-size original is for managers. Event page photos keep their event page visibility.

## Who does what
| | Volunteer | Trustee | Branch Manager / Regional Director |
|---|---|---|---|
| See, slideshow, story viewer | Yes | Yes | Yes |
| Upload | Upload request (≤ 20 photos, album/event or a proposed album, note) | — | Directly ("Add photos") |
| Albums, cover, order, delete | — | — | Yes (album deletion: type its name) |
| Move photos | — | — | Album ↔ album / event chapter; event page photo → album (not the cover; it becomes members-only) |
| Review upload requests | — | — | In Requests: approve all / some, decline with a reason |

Deleted and declined photos are removed at once (hard delete: Storage first, then the rows; no Recycle Bin).
Duplicates (same SHA-256 in the same album or event) are skipped and reported. The nightly cleanup
(`/api/public/cleanup-deleted-events`) sweeps leftovers (`media_cleanup_paths`, `clear_deleted_media`).

## Files
Private bucket `media-library`: `<branch id>/<photo id>.webp` plus `.w640.webp` and `.w1280.webp`, made in the browser
(canvas re-encode, long side ≤ 2000 px, no EXIF). Pending request files use the same layout; approval keeps the path.

## Local sample data
`cd e2e && npm run local:seed-media` (after `local:seed`, local stack only): three Medway events and two albums with
placeholder photos, a Brighton event that must never show in Medway's gallery, and a pending upload request.
