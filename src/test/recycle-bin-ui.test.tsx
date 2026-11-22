import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { RecycleRow } from '@/lib/recycle-bin';
const mocks = vi.hoisted(() => ({ manager: true, rows: [] as RecycleRow[], restore: vi.fn(), remove: vi.fn(), query: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (args: unknown) => { mocks.query(args); return { data: mocks.rows }; }, useQueryClient: () => ({ invalidateQueries: vi.fn(), removeQueries: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isManager: mocks.manager, profile: { status: 'active' }, session: { user: { id: 'actor' } } }) }));
vi.mock('@/lib/recycle-bin.functions', () => ({ listRecycleBin: vi.fn(), restoreRecycleItem: mocks.restore, permanentlyDeleteRecycleItem: mocks.remove }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
import { setLanguage } from '@/lib/i18n';
import { Route } from '@/routes/_app/recycle-bin';
const Component = (Route as unknown as { options: { component: () => ReactNode } }).options.component;
const event: RecycleRow = { id: 'event-id', type: 'event', title: 'Deleted event', branch: 'London', region: 'London region', deleted_by_name: 'Manager', deleted_at: '2026-11-21T12:00:00Z', days_left: 30, can_restore: true, role: null, self_requested: false, event_count: null, total_count: 1 };
beforeEach(() => { vi.clearAllMocks(); setLanguage('en'); mocks.manager = true; mocks.rows = [event]; mocks.restore.mockResolvedValue({ ok: true }); mocks.remove.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); setLanguage('en'); });
describe('Recycle Bin actions and access', () => {
  it('Restore dispatches the selected entity type and id', async () => {
    render(<Component />); fireEvent.click(screen.getByTestId('recycle-bin-restore'));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith({ data: { type: 'event', id: 'event-id' } }));
  });
  it('permanent deletion waits for exact DELETE, then dispatches the selected entity', async () => {
    render(<Component />); fireEvent.click(screen.getByTestId('recycle-bin-delete-permanently'));
    fireEvent.change(screen.getByTestId('recycle-bin-confirm-input'), { target: { value: 'delete' } });
    fireEvent.click(screen.getByTestId('recycle-bin-confirm-delete'));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('recycle-bin-confirm-input'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByTestId('recycle-bin-confirm-delete'));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ data: { type: 'event', id: 'event-id', confirmation: 'DELETE' } }));
  });
  it('self-requested account erasure has no restoration action', () => {
    mocks.rows = [{ ...event, type: 'user', can_restore: false, self_requested: true }];
    render(<Component />);
    expect(screen.queryByTestId('recycle-bin-restore')).toBeNull();
  });
  it('volunteer URL access never enables the private list or mutation controls', () => {
    mocks.manager = false; render(<Component />);
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.queryByTestId('recycle-bin-restore')).toBeNull();
    expect(screen.queryByTestId('recycle-bin-delete-permanently')).toBeNull();
  });
});