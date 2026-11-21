import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/cleanup-deleted-events')({
  ssr: false,
  server: { handlers: { POST: async ({ request }) => {
    const { cleanupAuthorized, cleanupDeletedEvents } = await import('@/lib/event-cleanup.server');
    if (!cleanupAuthorized(request.headers.get('Authorization'), process.env['CLEANUP_CRON_SECRET'])) {
      return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    try {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const result = await cleanupDeletedEvents(supabaseAdmin);
      return Response.json(result.counts, { status: result.failed ? 500 : 200, headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ events: 0, users: 0, files: 0 }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  } } },
});