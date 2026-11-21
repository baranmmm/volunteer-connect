import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ data: {} as Record<string, unknown>, remove: vi.fn(), navigate: vi.fn(), invalidate: vi.fn(), removeQueries: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options, useParams: () => ({ id: 'event-id' }) }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data }), useQueryClient: () => ({ invalidateQueries: mocks.invalidate, removeQueries: mocks.removeQueries }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'user-id' } }, profile: { status: 'active' } }) }));
vi.mock('@/lib/events.functions', () => ({ getEvent: vi.fn(), cancelEvent: vi.fn() }));
vi.mock('@/lib/delete-event.functions', () => ({ deleteEvent: mocks.remove }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/components/events/EventForm', () => ({ EventForm: () => null }));
vi.mock('@/components/events/EventDialog', () => ({ EventDialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section>{children}</section> : null }));
import '@/lib/i18n';
import { Route } from '@/routes/_app/events_.$id';

const Component = (Route as unknown as { options: { component: () => ReactNode } }).options.component;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
  mocks.data = { event: { id: 'event-id', title: 'Draft', organizer: 'Dialogue Society', category: 'community', status: 'draft', start_at: '2099-01-01T18:00:00Z', scope: 'branch', media: [] }, canManage: true, deletion: { canManage: true, canDelete: true, pending: false, reason: null } };
});
afterEach(cleanup);
describe('event deletion UI permissions and confirmation', () => {
  it('requires confirmation before deleting an eligible manager event, then returns to calendar', async () => {
    render(<Component />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('event-delete-confirm'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/calendar' }));
    expect(mocks.remove).toHaveBeenCalledWith({ data: { id: 'event-id' } });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ['event', 'event-id'] });
  });
  it('never offers deletion to a volunteer', () => {
    mocks.data['canManage'] = false;
    mocks.data['deletion'] = { canManage: false, canDelete: false, pending: false, reason: null };
    render(<Component />);
    expect(screen.queryByTestId('event-delete-button')).toBeNull();
    expect(screen.queryByTestId('event-delete-confirm')).toBeNull();
  });
  it.each(['published', 'cancelled'])('requires the exact title for %s events', async status => {
    mocks.data['event'] = { ...(mocks.data['event'] as object), status };
    render(<Component />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    const confirm = screen.getByTestId('event-delete-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('event-delete-title-input'), { target: { value: 'Wrong' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('event-delete-title-input'), { target: { value: 'Draft' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ data: { id: 'event-id', title: 'Draft' } }));
  });
  it('a past draft also requires its title', () => {
    mocks.data['event'] = { ...(mocks.data['event'] as object), start_at: '2020-01-01T00:00:00Z' };
    render(<Component />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect((screen.getByTestId('event-delete-confirm') as HTMLButtonElement).disabled).toBe(true);
  });
  it('allows retry but hides edits and cancellation during pending cleanup', () => {
    mocks.data['deletion'] = { canManage: true, canDelete: true, pending: true, reason: null };
    render(<Component />);
    expect(screen.getByTestId('event-delete-button')).toBeDefined();
    expect(screen.queryByTestId('event-edit-button')).toBeNull();
    expect(screen.queryByTestId('event-cancel-event-button')).toBeNull();
  });
});