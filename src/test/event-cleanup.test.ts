import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { cleanupAuthorized, cleanupDeletedEvents } from '@/lib/event-cleanup.server';

function client(events: { id: string }[] = [{ id: 'expired-event' }]) {
  const rpc = vi.fn().mockResolvedValueOnce({ data: { paths: ['deleted/expired-event/image.png'], deleted: false }, error: null }).mockResolvedValueOnce({ data: { paths: [], deleted: true }, error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const query = { lt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: events, error: null }) };
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn((table: string) => table === 'events' ? { select: () => query } : { insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'audit-run' }, error: null }) }) }), update });
  return { client: { from, rpc, storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>, rpc, remove, query, update };
}
describe('scheduled event cleanup', () => {
  it('fails closed for missing or mismatched authorization', () => {
    expect(cleanupAuthorized(null, undefined)).toBe(false);
    expect(cleanupAuthorized('Bearer invalid', 'test-only-fixture')).toBe(false);
    expect(cleanupAuthorized('Bearer test-only-fixture', 'test-only-fixture')).toBe(true);
  });
  it('uses a strict 30-day cutoff, 25-event batch, removes files before rows, and audits counts', async () => {
    const m = client();
    const result = await cleanupDeletedEvents(m.client, new Date('2026-11-21T03:30:00Z'));
    expect(m.query.lt).toHaveBeenCalledWith('deleted_at', '2026-10-22T03:30:00.000Z');
    expect(m.query.limit).toHaveBeenCalledWith(25);
    expect(m.remove).toHaveBeenCalledWith(['deleted/expired-event/image.png']);
    expect(m.remove.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[1] ?? 0);
    expect(result).toEqual({ counts: { events: 1, files: 1 }, failed: false });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ events_purged: 1, files_purged: 1, outcome: 'completed' }));
  });
  it('does not remove rows on file cleanup failure; logs a failed run', async () => {
    const m = client(); m.remove.mockResolvedValue({ error: { message: 'unavailable' } });
    expect(await cleanupDeletedEvents(m.client)).toEqual({ counts: { events: 0, files: 0 }, failed: true });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });
  it('running twice after the first drain is harmless and returns only counts', async () => {
    const m = client([]);
    expect(await cleanupDeletedEvents(m.client)).toEqual({ counts: { events: 0, files: 0 }, failed: false });
    expect(await cleanupDeletedEvents(m.client)).toEqual({ counts: { events: 0, files: 0 }, failed: false });
    expect(m.remove).not.toHaveBeenCalled();
  });
});