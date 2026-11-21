import { EVENT_CATEGORIES, londonToIso } from './event-rules';

export type EventFormFields = { title: string; start: string; end: string; location: string; category: string; scope: string; branch: string; capacity: string; organizer: string };
export function validateEventForm(fields: EventFormFields, status: string) {
  const errors: Record<string, string> = {};
  if (!fields.title.trim()) errors['title'] = 'events.fieldRequired';
  if (fields.title.length > 200) errors['title'] = 'events.invalid';
  if (status !== 'draft') {
    for (const key of ['start', 'end', 'location'] as const) if (!fields[key].trim()) errors[key] = 'events.fieldRequired';
    if (!EVENT_CATEGORIES.some(c => c === fields.category)) errors['category'] = 'events.fieldRequired';
    if (!['branch', 'region'].includes(fields.scope)) errors['scope'] = 'events.fieldRequired';
    if (fields.scope === 'branch' && !fields.branch) errors['branch'] = 'events.fieldRequired';
  }
  for (const key of ['start', 'end'] as const) {
    if (fields[key]) try { londonToIso(fields[key]); } catch { errors[key] = 'events.timeError'; }
  }
  if (!errors['start'] && !errors['end'] && fields.start && fields.end && londonToIso(fields.end) < londonToIso(fields.start)) errors['end'] = 'events.dateError';
  if (fields.capacity && (!Number.isInteger(Number(fields.capacity)) || Number(fields.capacity) < 1)) errors['capacity'] = 'events.invalid';
  if (fields.organizer.length > 200) errors['organizer'] = 'events.invalid';
  return errors;
}