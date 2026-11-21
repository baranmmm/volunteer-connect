import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { Database } from '@/integrations/supabase/types';

export const EVENT_CATEGORIES = ['dialogue', 'dinner', 'interfaith', 'community', 'education', 'other'] as const;
export const MAX_EVENT_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 2000;
export type EventRow = Database['public']['Tables']['events']['Row'];
export type MediaRow = Database['public']['Tables']['event_media']['Row'];
export type EventMedia = MediaRow & { url: string | null };
export type HubEvent = EventRow & { media: EventMedia[] };
export type EventInput = { title: string; description: string; location: string; organizer: string; category: string; start_at: string; end_at: string | null; scope: string; branch_id: string | null; capacity: number | null; status: string };
export const LONDON = 'Europe/London';
export function londonInput(value: string | Date) { return formatInTimeZone(value, LONDON, "yyyy-MM-dd'T'HH:mm"); }
export function londonToIso(value: string) {
  const date = fromZonedTime(value, LONDON);
  if (!Number.isFinite(date.getTime()) || londonInput(date) !== value) throw new Error('Invalid London time');
  return date.toISOString();
}
export function imageDimensions(width: number, height: number) {
  const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
export function validateEventFile(file: { type: string; size: number }, count: number) {
  if (count >= MAX_EVENT_FILES) throw new Error('Maximum 5 files per event');
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) throw new Error('Invalid event file');
  if (file.size > MAX_FILE_BYTES) throw new Error('Event file exceeds 10 MB');
}
export function filterEvents(events: HubEvent[], past: boolean, category: string, organizer: string, now = new Date()) {
  return events.filter(e => (past ? new Date(e.end_at ?? e.start_at) < now : new Date(e.end_at ?? e.start_at) >= now) && (category === 'all' || e.category === category) && (organizer === 'all' || e.organizer === organizer))
    .sort((a, b) => (past ? -1 : 1) * (Date.parse(a.start_at) - Date.parse(b.start_at)) || a.id.localeCompare(b.id));
}
function escapeIcs(value: string) { return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
function utcStamp(value: string | Date) { return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function foldLine(line: string) {
  let result = '', bytes = 0;
  for (const char of line) { const size = new TextEncoder().encode(char).length; if (bytes + size > 75) { result += '\r\n '; bytes = 1; } result += char; bytes += size; }
  return result;
}
export function eventIcs(event: EventRow, url: string, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dialogue Society//Volunteer Hub//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${event.id}@dialoguesociety.org`, `DTSTAMP:${utcStamp(now)}`, `DTSTART:${utcStamp(event.start_at)}`];
  if (event.end_at) lines.push(`DTEND:${utcStamp(event.end_at)}`);
  lines.push(`SUMMARY:${escapeIcs(event.title)}`, `DESCRIPTION:${escapeIcs(event.description)}`, `LOCATION:${escapeIcs(event.location)}`, `URL:${escapeIcs(url)}`, `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
