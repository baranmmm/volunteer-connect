import { createFileRoute } from "@tanstack/react-router";

// Nightly cleanup (pg_cron job 'recycle-bin-cleanup' at 03:30 UTC, and the manual "Cleanup Recycle Bin" workflow, with
// SCHEDULED_JOBS_SECRET: src/lib/scheduled-jobs.server.ts): expired Recycle Bin items, then the
// guest/subscriber retention rules (purge_guest_data; pg_cron runs it too where available), then YouTube poster files
// no video points at any more, then Media files that must go (src/lib/media-cleanup.server.ts). Only counts are
// returned.
const GUEST_COUNTS = [
  "guest_registrations",
  "pending_guests",
  "unconfirmed_subscribers",
  "outbox",
  "rate_limits",
] as const;
const emptyGuestCounts = () => Object.fromEntries(GUEST_COUNTS.map((k) => [`guest_data_${k}`, 0]));

export const Route = createFileRoute("/api/public/cleanup-deleted-events")({
  ssr: false,
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { scheduledJobAuthorized, unauthorizedResponse } =
          await import("@/lib/scheduled-jobs.server");
        if (!scheduledJobAuthorized(request.headers.get("Authorization"))) {
          return unauthorizedResponse();
        }
        const { cleanupDeletedEvents } = await import("@/lib/event-cleanup.server");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await cleanupDeletedEvents(supabaseAdmin);
          const guest = await supabaseAdmin.rpc("purge_guest_data");
          const raw = (
            guest.data && typeof guest.data === "object" && !Array.isArray(guest.data)
              ? guest.data
              : {}
          ) as Record<string, unknown>;
          const guestCounts = Object.fromEntries(
            GUEST_COUNTS.map((k) => [`guest_data_${k}`, typeof raw[k] === "number" ? raw[k] : 0]),
          );
          const { sweepOrphanVideoPosters } = await import("@/lib/video-posters.server");
          let posters = 0,
            postersFailed = false;
          try {
            posters = await sweepOrphanVideoPosters(supabaseAdmin);
          } catch {
            postersFailed = true;
          }
          const { sweepMediaLibrary } = await import("@/lib/media-cleanup.server");
          let mediaFiles = 0,
            mediaFailed = false;
          try {
            mediaFiles = await sweepMediaLibrary(supabaseAdmin);
          } catch {
            mediaFailed = true;
          }
          const failed = result.failed || guest.error !== null || postersFailed || mediaFailed;
          return Response.json(
            { ...result.counts, ...guestCounts, video_posters: posters, media_files: mediaFiles },
            { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            {
              events: 0,
              users: 0,
              files: 0,
              ...emptyGuestCounts(),
              video_posters: 0,
              media_files: 0,
            },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
