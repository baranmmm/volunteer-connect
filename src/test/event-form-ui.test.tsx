import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ save: vi.fn(), saved: vi.fn(), reorder: vi.fn(), invalidate: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [], isLoading: false }), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'director' } }, roles: ['regional_director'], profile: { branch_id: null } }) }));
vi.mock('@/lib/events.functions', () => ({ saveEvent: mocks.save, eventBranches: vi.fn(), reserveEventMedia: vi.fn(), deleteEventMedia: vi.fn(), reorderEventMedia: mocks.reorder }));
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
    await waitFor(() => expect(screen.getByTestId('event-form-start').getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByTestId('event-form-end').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('event-form-location').getAttribute('aria-invalid')).toBe('true');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});describe('A2a form controls', () => {
  it('All day hides time inputs and shows date pickers; End follows Start + 2 hours', () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId('event-form-start'), { target: { value: '2027-01-10T18:00' } });
    expect((screen.getByTestId('event-form-end') as HTMLInputElement).value).toBe('2027-01-10T20:00');
    fireEvent.click(screen.getByTestId('event-form-all-day'));
    expect(screen.queryByTestId('event-form-start')).toBeNull();
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
