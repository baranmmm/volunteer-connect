import { beforeEach, describe, expect, it, vi } from 'vitest';
import { permanentDeleteInput } from '@/lib/recycle-bin';

const mocks = vi.hoisted(() => ({ scoped: vi.fn(), adminRpc: vi.fn(), unban: vi.fn(), erase: vi.fn(), remove: vi.fn(), move: vi.fn(), exists: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ middleware: () => ({ inputValidator: () => ({ handler: (handler: unknown) => handler }) }) }) }));
vi.mock('@/integrations/supabase/auth-middleware', () => ({ requireSupabaseAuth: {} }));
vi.mock('@/lib/require-member', () => ({ requireMember: {} }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { rpc: mocks.adminRpc, auth: { admin: { updateUserById: mocks.unban, deleteUser: mocks.erase } }, storage: { from: () => ({ remove: mocks.remove, move: mocks.move, exists: mocks.exists }) } } }));
import { restoreRecycleItem, permanentlyDeleteRecycleItem } from '@/lib/recycle-bin.functions';
const id = '10000000-0000-4000-8000-000000000001';
const runRestore = restoreRecycleItem as unknown as (input: unknown) => Promise<unknown>;
const runPurge = permanentlyDeleteRecycleItem as unknown as (input: unknown) => Promise<unknown>;
const input = (type: string) => ({ data: { type, id, confirmation: 'DELETE' }, context: { supabase: { rpc: mocks.scoped } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scoped.mockResolvedValue({ data: { paths: [], deleted: false }, error: null });
  mocks.adminRpc.mockResolvedValue({ data: { paths: [], deleted: false }, error: null });
  mocks.unban.mockResolvedValue({ error: null }); mocks.erase.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null });
});
describe('Recycle Bin external resource orchestration', () => {
  it('requires exact DELETE and known types at the server input boundary', () => {
    expect(permanentDeleteInput.safeParse({ type: 'user', id, confirmation: 'DELETE' }).success).toBe(true);
    expect(permanentDeleteInput.safeParse({ type: 'user', id, confirmation: 'delete' }).success).toBe(false);
    expect(permanentDeleteInput.safeParse({ type: 'unknown', id, confirmation: 'DELETE' }).success).toBe(false);
  });
  it('permission rejection prevents every privileged Auth/Storage operation', async () => {
    mocks.scoped.mockResolvedValue({ error: { message: 'Not allowed' } });
    await expect(runRestore(input('user'))).rejects.toThrow('Not allowed');
    await expect(runPurge(input('event'))).rejects.toThrow('Not allowed');
    expect(mocks.adminRpc).not.toHaveBeenCalled(); expect(mocks.unban).not.toHaveBeenCalled(); expect(mocks.erase).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('user restoration unbans only after database authorization, then restores visibility', async () => {
    await runRestore(input('user'));
    expect(mocks.scoped).toHaveBeenCalledWith('restore_item', { _type: 'user', _id: id });
    expect(mocks.unban).toHaveBeenCalledWith(id, { ban_duration: 'none' });
    expect(mocks.scoped.mock.invocationCallOrder[0]).toBeLessThan(mocks.unban.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.unban.mock.invocationCallOrder[0]).toBeLessThan(mocks.adminRpc.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.adminRpc).toHaveBeenCalledWith('finish_user_recycle_operation', { _id: id, _operation: 'restore' });
  });
  it('failed unban never reveals the deleted profile', async () => {
    mocks.unban.mockResolvedValue({ error: { message: 'unavailable' } });
    await expect(runRestore(input('user'))).rejects.toThrow('Account restoration failed');
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it('user erasure follows permission and durable audit preparation, then finalizes after Auth deletion', async () => {
    await runPurge(input('user'));
    expect(mocks.scoped).toHaveBeenCalledWith('permanent_delete_item', { _type: 'user', _id: id, _confirmation: 'DELETE' });
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(1, 'prepare_user_purge', { _id: id });
    expect(mocks.adminRpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.erase.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.erase.mock.invocationCallOrder[0]).toBeLessThan(mocks.adminRpc.mock.invocationCallOrder[1] ?? 0);
    expect(mocks.adminRpc).toHaveBeenLastCalledWith('finish_user_recycle_operation', { _id: id, _operation: 'purge' });
  });
  it('Auth erasure failure leaves durable blocked state for retry', async () => {
    mocks.erase.mockResolvedValue({ error: { message: 'unavailable' } });
    await expect(runPurge(input('user'))).rejects.toThrow('Account erasure failed');
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
  });
  it('event permanent deletion removes private files before finalizing rows', async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: { paths: [`deleted/${id}/file.pdf`], deleted: false } }).mockResolvedValueOnce({ data: { paths: [], deleted: true } });
    await runPurge(input('event'));
    expect(mocks.remove).toHaveBeenCalledWith([`deleted/${id}/file.pdf`]);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.adminRpc.mock.invocationCallOrder[1] ?? 0);
  });
});