import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ save: vi.fn(), saved: vi.fn(), reorder: vi.fn(), invalidate: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [], isLoading: false }), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'director' } }, roles: ['regional_director'], profile: { branch_id: null } }) }));
vi.mock('@/lib/events.functions', () => ({ saveEvent: mocks.save, eventBranches: vi.fn(), reserveEventMedia: vi.fn(), deleteEventMedia: vi.fn(), reorderEventMedia: mocks.reorder, createSeries: vi.fn(), updateSeriesEvent: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/components/events/EventDialog', () => ({ EventDialog: ({ children }: { children: ReactNode }) => <section>{children}</section> }));
import '@/lib/i18n';
import { EventForm } from '@/components/events/EventForm';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue('saved-draft');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
/** Radix Select keeps a hidden native <select> next to its trigger inside a form; changing it selects the option. */
function pickTime(testId: string, value: string) {
  const native = screen.getByTestId(testId).parentElement?.querySelector('select');
  if (!native) throw new Error(`no native select for ${testId}`);
  fireEvent.change(native, { target: { value } });
}
describe('event form actionable validation', () => {
  it('empty Save draft and Publish remain enabled, validate on click and focus the title', async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    for (const id of ['event-form-save-draft', 'event-form-publish']) {
      const button = screen.getByTestId(id) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('event-form-title')));
      expect(screen.getByTestId('event-form-title').getAttribute('aria-invalid')).toBe('true');
      expect(mocks.save).not.toHaveBeenCalled();
    }
  });
  it('a title-only draft saves with no fabricated date, then calls onSaved', async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId('event-form-title'), { target: { value: 'Only a title' } });
    fireEvent.click(screen.getByTestId('event-form-save-draft'));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledWith('saved-draft'));
    expect(mocks.save).toHaveBeenCalledWith({ data: { id: null, event: expect.objectContaining({ title: 'Only a title', start_at: null, end_at: null, status: 'draft', scope: 'region', branch_id: null }) } });
  });
  it('Publish reports missing location/start/end instead of silently disabling', async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId('event-form-title'), { target: { value: 'Publish me' } });
    fireEvent.click(screen.getByTestId('event-form-publish'));
    await waitFor(() => expect(screen.getByTestId('event-form-start-date').getAttribute('aria-invalid')).toBe('true'));
    for (const id of ['event-form-start-time', 'event-form-end-date', 'event-form-end-time']) expect(screen.getByTestId(id).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('event-form-location').getAttribute('aria-invalid')).toBe('true');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});describe('A2a form controls', () => {
  it('All day hides time inputs and shows date pickers; End follows Start + 2 hours', () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId('event-form-start-date'), { target: { value: '2027-01-10' } });
    pickTime('event-form-start-time', '18:00');
    expect((screen.getByTestId('event-form-end-date') as HTMLInputElement).value).toBe('2027-01-10');
    expect(screen.getByTestId('event-form-end-time').textContent).toBe('20:00');
    // Late start: End moves to the next day.
    pickTime('event-form-start-time', '23:15');
    expect((screen.getByTestId('event-form-end-date') as HTMLInputElement).value).toBe('2027-01-11');
    expect(screen.getByTestId('event-form-end-time').textContent).toBe('01:15');
    fireEvent.click(screen.getByTestId('event-form-all-day'));
    expect(screen.queryByTestId('event-form-start-time')).toBeNull();
    expect(screen.queryByTestId('event-form-end-time')).toBeNull();
    expect((screen.getByTestId('event-form-start-date') as HTMLInputElement).type).toBe('date');
    expect((screen.getByTestId('event-form-end-date') as HTMLInputElement).type).toBe('date');
  });
  it('offers a location type and accepts Word and PowerPoint files', () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    expect(screen.getByTestId('event-form-location-type')).toBeTruthy();
    const accept = (screen.getByTestId('event-form-file-input') as HTMLInputElement).accept;
    expect(accept).toContain('.docx');
    expect(accept).toContain('.pptx');
  });
});
describe('quarter-hour time picker', () => {
  it('lists 00:00..23:45 in 15-minute steps and keeps an off-grid time of an existing event', async () => {
    const { QUARTER_HOURS, timeOptions } = await import('@/lib/time-options');
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(QUARTER_HOURS.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(QUARTER_HOURS.at(-1)).toBe('23:45');
    const withOdd = timeOptions(['21:51']);
    expect(withOdd).toHaveLength(97);
    expect(withOdd.slice(withOdd.indexOf('21:45'), withOdd.indexOf('21:45') + 3)).toEqual(['21:45', '21:51', '22:00']);
    const event = { id: 'e1', title: 'Old', description: '', location: 'Hall', location_type: 'in_person', online_url: null, organizer: 'Dialogue Society', category: 'dialogue', status: 'published', all_day: false, start_date: null, end_date: null, start_at: '2027-01-10T21:51:00Z', end_at: '2027-01-10T23:07:00Z', capacity: null, scope: 'branch', branch_id: 'b1', media: [] };
    render(<EventForm event={event as never} onClose={vi.fn()} onSaved={mocks.saved} />);
    expect(screen.getByTestId('event-form-start-time').textContent).toBe('21:51');
    expect(screen.getByTestId('event-form-end-time').textContent).toBe('23:07');
    // Changing to a quarter hour and back: the original 21:51 is still an option.
    pickTime('event-form-start-time', '22:00');
    expect(screen.getByTestId('event-form-start-time').textContent).toBe('22:00');
    pickTime('event-form-start-time', '21:51');
    expect(screen.getByTestId('event-form-start-time').textContent).toBe('21:51');
  });
});
