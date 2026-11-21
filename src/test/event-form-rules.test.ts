import { describe, expect, it } from 'vitest';
import { validateEventForm } from '@/lib/event-form-rules';

const empty = { title: '', start: '', end: '', location: '', category: '', scope: '', branch: '', capacity: '', organizer: '' };
describe('event publishing and deletion rules', () => {
  it('drafts require only a title', () => {
    expect(validateEventForm({ ...empty, title: 'New draft' }, 'draft')).toEqual({});
    expect(validateEventForm(empty, 'draft')).toEqual({ title: 'events.fieldRequired' });
  });
  it('publishing requires title, start, end, location, category and scope', () => {
    expect(Object.keys(validateEventForm(empty, 'published'))).toEqual(['title', 'start', 'end', 'location', 'category', 'scope']);
  });
  it('branch publication requires a branch', () => {
    expect(validateEventForm({ ...empty, title: 'Event', start: '2027-01-01T18:00', end: '2027-01-01T19:00', location: 'London', category: 'dialogue', scope: 'branch' }, 'published')).toEqual({ branch: 'events.fieldRequired' });
  });
  it('end must not precede start', () => {
    expect(validateEventForm({ ...empty, title: 'Event', start: '2027-01-01T18:00', end: '2027-01-01T17:00' }, 'draft')).toEqual({ end: 'events.dateError' });
  });
});