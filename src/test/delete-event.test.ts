import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), move: vi.fn(), exists: vi.fn(), bucket: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ middleware: () => ({ inputValidator: () => ({ handler: (handler: unknown) => handler }) }) }) }));
vi.mock('@/integrations/supabase/auth-middleware', () => ({ requireSupabaseAuth: {} }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { storage: { from: mocks.bucket } } }));
import { deleteEvent } from '@/lib/delete-event.functions';

const id = '11111111-1111-4111-8111-111111111111';
const paths = [`${id}/photo.jpg`, `${id}/leaflet.pdf`];
const run = deleteEvent as unknown as (input: unknown) => Promise<void>;
const input = { data: { id }, context: { supabase: { rpc: mocks.rpc } } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.bucket.mockReturnValue({ move: mocks.move, exists: mocks.exists });
  mocks.move.mockResolvedValue({ error: null });
  mocks.exists.mockResolvedValue({ data: true, error: null });
  mocks.rpc.mockResolvedValueOnce({ data: { paths, deleted: false }, error: null }).mockResolvedValueOnce({ data: { paths: [], deleted: true }, error: null });
});
describe('event deletion storage orchestration', () => {
  it('authorizes before private Storage archiving and finalizes only afterward', async () => {
    await run(input);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'delete_event', { _event: id });
    expect(mocks.bucket).toHaveBeenCalledWith('event-media');
    for (const path of paths) expect(mocks.move).toHaveBeenCalledWith(path, `deleted/${path}`);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'delete_event', { _event: id, _complete: true });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.move.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.move.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1] ?? 0);
  });
  it('does not touch Storage when a volunteer is rejected', async () => {
    mocks.rpc.mockReset().mockResolvedValue({ error: { message: 'Not allowed' } });
    await expect(run(input)).rejects.toThrow('Not allowed');
    expect(mocks.bucket).not.toHaveBeenCalled();
  });
  it.each(['returned', 'thrown'])('does not finalize after a %s storage failure', async (kind) => {
    if (kind === 'returned') mocks.move.mockResolvedValue({ error: { message: 'Storage unavailable' } });
    else mocks.move.mockRejectedValue(new Error('Event deletion cleanup failed'));
    await expect(run(input)).rejects.toThrow('Event deletion cleanup failed');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('allows a no-file draft to complete without calling Storage', async () => {
    mocks.rpc.mockReset().mockResolvedValueOnce({ data: { paths: [], deleted: false } }).mockResolvedValueOnce({ data: { paths: [], deleted: true } });
    await run(input);
    expect(mocks.bucket).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('surfaces server refusal if files still exist at finalization', async () => {
    mocks.rpc.mockReset().mockResolvedValueOnce({ data: { paths, deleted: false } }).mockResolvedValueOnce({ error: { message: 'Event files still exist' } });
    await expect(run(input)).rejects.toThrow('Event files still exist');
  });
});