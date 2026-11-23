import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { HubEvent } from '@/lib/event-rules';

const mocks = vi.hoisted(() => ({ rows: [] as HubEvent[] }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  Link: ({ children, to: _to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.rows, isLoading: false, isError: false }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'volunteer' } }, profile: { status: 'active' }, isManager: false, roles: ['volunteer'] }) }));
vi.mock('@/lib/events.functions', () => ({ listEvents: vi.fn() }));
vi.mock('@/components/events/EventForm', () => ({ EventForm: () => null }));
vi.mock('@/components/events/RecentlyDeletedEvents', () => ({ RecentlyDeletedEvents: () => null }));
vi.mock('@/components/requests/RequestEventButton', () => ({ RequestEventButton: () => null }));
vi.mock('@/lib/use-event-requests', () => ({ useCanRequestEvents: () => false }));
import { setLanguage } from '@/lib/i18n';
import { Route } from '@/routes/_app/calendar';

const Component = (Route as unknown as { options: { component: () => ReactNode } }).options.component;
const ongoing: HubEvent = { id: 'ongoing', title: 'Ongoing gathering', description: '', location: 'London', organizer: 'Dialogue Society', category: 'dialogue', start_at: '2026-11-21T12:00:00Z', end_at: '2026-11-21T14:00:00Z', capacity: null, registration_enabled: true, is_external: false, audience: 'members', scope: 'branch', branch_id: null, region_id: 'region', status: 'published', created_at: '', updated_at: '', created_by: null, deleted_at: null, deleted_by: null, all_day: false, start_date: null, end_date: null, location_type: 'in_person', online_url: null, series_id: null, recurrence_key: null, series_exception: false, series_template: false, deleted_with_series: false, media: [] };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  setLanguage('en');
  mocks.rows = [ongoing, { ...ongoing, id: 'past', title: 'Earlier gathering', start_at: '2026-11-21T09:00:00Z', end_at: '2026-11-21T10:00:00Z' }];
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setLanguage('en'); });
describe('ongoing events calendar flow', () => {
  it('shows ongoing and past events in Month, limits toggles to List, and moves an ended event to Past', () => {
    render(<Component />);
    const month = screen.getByTestId('calendar-month-view');
    expect(month.querySelector('[data-event-id="ongoing"]')).not.toBeNull();
    expect(month.querySelector('[data-event-id="past"]')).not.toBeNull();
    expect(screen.queryByTestId('calendar-filter-past')).toBeNull();
    expect(screen.getByTestId('event-badge-happening-now')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByTestId('calendar-list-view').querySelector('[data-event-id="ongoing"]')).not.toBeNull();
    expect(screen.getByTestId('calendar-list-view').querySelector('[data-event-id="past"]')).toBeNull();
    fireEvent.click(screen.getByTestId('calendar-filter-past'));
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByTestId('calendar-month-view').querySelector('[data-event-id="ongoing"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByTestId('calendar-filter-upcoming'));
    act(() => { vi.setSystemTime(new Date('2026-11-21T14:00:01Z')); vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('calendar-list-view').querySelector('[data-event-id="ongoing"]')).toBeNull();
    expect(screen.queryByTestId('event-badge-happening-now')).toBeNull();
    fireEvent.click(screen.getByTestId('calendar-filter-past'));
    expect(screen.getByTestId('calendar-list-view').querySelector('[data-event-id="ongoing"]')).not.toBeNull();
  });
});