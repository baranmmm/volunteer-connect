import { EVENT_CATEGORIES, londonToIso } from './event-rules';

export type EventFormFields = { title: string; allDay?: boolean; start: string; end: string; startDate?: string; endDate?: string; locationType?: 'in_person' | 'online'; location: string; onlineUrl?: string; category: string; scope: string; branch: string; capacity: string; organizer: string };
export const ONLINE_URL = /^https:\/\/[^\s/?#]+\.[^\s]*$/;
/** Shared publish rules; the database trigger enforces the same rules for direct API calls. */
export function validateEventForm(fields: EventFormFields, status: string, options: { now?: Date; checkPast?: boolean } = {}) {
  const now = options.now ?? new Date();
  const errors: Record<string, string> = {};
  const allDay = !!fields.allDay, online = fields.locationType === 'online';
  const startDate = fields.startDate ?? '', endDate = fields.endDate ?? '', onlineUrl = (fields.onlineUrl ?? '').trim();
  if (!fields.title.trim()) errors['title'] = 'events.fieldRequired';
  if (fields.title.length > 200) errors['title'] = 'events.invalid';
  if (onlineUrl && !ONLINE_URL.test(onlineUrl)) errors['online-url'] = 'events.onlineUrlError';
  if (!allDay) for (const key of ['start', 'end'] as const) {
    if (fields[key]) try { londonToIso(fields[key]); } catch { errors[key] = 'events.timeError'; }
  }
  if (status !== 'draft') {
    if (allDay) { if (!startDate) errors['start-date'] = 'events.fieldRequired'; }
    else for (const key of ['start', 'end'] as const) if (!fields[key].trim() && !errors[key]) errors[key] = 'events.fieldRequired';
    if (online) { if (!onlineUrl) errors['online-url'] = 'events.fieldRequired'; }
    else if (!fields.location.trim()) errors['location'] = 'events.fieldRequired';
    if (!EVENT_CATEGORIES.some(c => c === fields.category)) errors['category'] = 'events.fieldRequired';
    if (!['branch', 'region'].includes(fields.scope)) errors['scope'] = 'events.fieldRequired';
    if (fields.scope === 'branch' && !fields.branch) errors['branch'] = 'events.fieldRequired';
  }
  if (allDay) {
    if (startDate && endDate && endDate < startDate) errors['end-date'] = 'events.dateError';
  } else if (!errors['start'] && !errors['end'] && fields.start && fields.end && Date.parse(londonToIso(fields.end)) <= Date.parse(londonToIso(fields.start))) errors['end'] = 'events.dateError';
  if (status === 'published' && options.checkPast !== false) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
    if (allDay && startDate && !errors['end-date'] && (endDate || startDate) < today) errors['end-date'] = 'events.pastPublishError';
    if (!allDay && fields.end && !errors['end'] && Date.parse(londonToIso(fields.end)) < now.getTime()) errors['end'] = 'events.pastPublishError';
  }
  if (fields.capacity && (!Number.isInteger(Number(fields.capacity)) || Number(fields.capacity) < 1)) errors['capacity'] = 'events.invalid';
  if (fields.organizer.length > 200) errors['organizer'] = 'events.invalid';
  return errors;
}
