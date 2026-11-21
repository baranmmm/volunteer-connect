import { describe, expect, it } from 'vitest';
import { eventTimeState, eventOccursOn, eventFileExtension, eventUploadError, normalizeEventExtension, eventIcs, filterEvents, imageDimensions, londonInput, londonToIso, validateEventFile, type HubEvent } from '@/lib/event-rules';

const event: HubEvent = { id:'11111111-1111-4111-8111-111111111111', title:'Community dinner',description:'A shared meal',location:'London',organizer:'Dialogue Society',category:'dinner',start_at:'2027-06-01T17:00:00Z',end_at:null,capacity:null,scope:'branch',branch_id:null,region_id:'r',status:'published',created_by:null,created_at:'',updated_at:'',deleted_at:null,deleted_by:null,all_day:false,start_date:null,end_date:null,location_type:'in_person',online_url:null,media:[] };
describe('event rules', () => {
  it('an event starting now and ending in two hours stays Upcoming through its end, then moves to Past', () => {
    const ongoing = { ...event, start_at: '2026-11-21T22:05:00Z', end_at: '2026-11-22T00:05:00Z' };
    for (const now of ['2026-11-21T22:05:00Z', '2026-11-21T23:05:00Z', '2026-11-22T00:05:00Z']) {
      expect(filterEvents([ongoing], false, 'all', 'all', new Date(now))).toEqual([ongoing]);
      expect(filterEvents([ongoing], true, 'all', 'all', new Date(now))).toEqual([]);
      expect(eventTimeState(ongoing, new Date(now)).happeningNow).toBe(true);
    }
    const ended = new Date('2026-11-22T00:05:00.001Z');
    expect(filterEvents([ongoing], false, 'all', 'all', ended)).toEqual([]);
    expect(filterEvents([ongoing], true, 'all', 'all', ended)).toEqual([ongoing]);
    expect(eventTimeState(ongoing, ended).happeningNow).toBe(false);
  });
  it('Month keeps past, ongoing and future events regardless of List time filters', () => {
    const now = new Date('2027-06-01T18:00:00Z');
    const rows = [{ ...event, id: 'past' }, { ...event, id: 'ongoing', end_at: '2027-06-01T19:00:00Z' }, { ...event, id: 'future', start_at: '2027-06-02T18:00:00Z' }];
    expect(filterEvents(rows, null, 'all', 'all', now).map(e => e.id)).toEqual(['ongoing', 'past', 'future']);
    expect(filterEvents(rows, null, 'education', 'all', now)).toEqual([]);
  });
  it('a multi-day event occurs on every London calendar date it spans', () => {
    const spanning = { start_at: '2027-06-01T22:30:00Z', end_at: '2027-06-02T01:00:00Z' };
    expect(eventOccursOn(spanning, '2027-06-01')).toBe(true);
    expect(eventOccursOn(spanning, '2027-06-02')).toBe(true);
    expect(eventOccursOn(spanning, '2027-06-03')).toBe(false);
  });
  it('date-only all-day events compare inclusive London dates, including BST midnight', () => {
    const allDay = { start_at: '2027-06-02', end_at: '2027-06-02' };
    expect(eventTimeState(allDay, new Date('2027-06-01T23:00:00Z'))).toEqual({ past: false, happeningNow: true });
    expect(eventTimeState(allDay, new Date('2027-06-02T22:59:59Z'))).toEqual({ past: false, happeningNow: true });
    expect(eventTimeState(allDay, new Date('2027-06-02T23:00:00Z'))).toEqual({ past: true, happeningNow: false });
  });
  it('equivalent UTC and offset timestamps have identical ongoing and calendar-day results', () => {
    const utc = { start_at: '2027-06-01T23:30:00Z', end_at: '2027-06-02T01:30:00Z' };
    const offset = { start_at: '2027-06-01T16:30:00-07:00', end_at: '2027-06-01T18:30:00-07:00' };
    const now = new Date('2027-06-02T00:00:00Z');
    expect(eventTimeState(utc, now)).toEqual({ past: false, happeningNow: true });
    expect(eventTimeState(offset, now)).toEqual(eventTimeState(utc, now));
    expect(eventOccursOn(offset, '2027-06-02')).toBe(true);
    expect(eventOccursOn(offset, '2027-06-01')).toBe(false);
  });
  it('normalizes phone JPEG extensions to jpg on storage paths', () => {
    expect(normalizeEventExtension('jpeg')).toBe('jpg');
    expect(normalizeEventExtension('JPEG')).toBe('jpg');
    expect(eventFileExtension('image/jpeg')).toBe('jpg');
    expect(eventFileExtension('image/png')).toBe('png');
    expect(eventFileExtension('application/pdf')).toBe('pdf');
  });
  it('rejects txt files', () => {
    expect(() => validateEventFile({ type: 'text/plain', size: 100 }, 0)).toThrow('Invalid event file');
  });
  it('classifies bucket MIME rejections', () => {
    expect(eventUploadError({ code: 'InvalidMimeType', message: 'Rejected' }).message).toBe('Invalid event file');
    expect(eventUploadError({ message: 'mime type text/plain is not supported' }).message).toBe('Invalid event file');
  });
  it('classifies bucket 10 MB size rejections', () => {
    expect(eventUploadError({ code: 'EntityTooLarge' }).message).toBe('Event file exceeds 10 MB');
    expect(eventUploadError({ message: 'The object exceeded the maximum allowed size' }).message).toBe('Event file exceeds 10 MB');
  });
  it('converts summer London input using BST, not the browser time zone', () => {
    expect(londonToIso('2027-06-01T18:00')).toBe('2027-06-01T17:00:00.000Z');
    expect(londonInput('2027-06-01T17:00:00Z')).toBe('2027-06-01T18:00');
  });
  it('converts winter London input using GMT', () => {
    expect(londonToIso('2027-01-01T18:00')).toBe('2027-01-01T18:00:00.000Z');
  });
  it('rejects nonexistent spring-forward London times', () => {
    expect(() => londonToIso('2027-03-28T01:30')).toThrow('Invalid London time');
  });
  it('limits the longest image side to 2000 pixels without upscaling', () => {
    expect(imageDimensions(4000,3000)).toEqual({width:2000,height:1500});
    expect(imageDimensions(1000,4000)).toEqual({width:500,height:2000});
    expect(imageDimensions(300,200)).toEqual({width:300,height:200});
  });
  it('accepts exactly 10 MB and rejects anything larger', () => {
    expect(() => validateEventFile({type:'application/pdf',size:10485760},0)).not.toThrow();
    expect(() => validateEventFile({type:'image/png',size:10485761},0)).toThrow('10 MB');
  });
  it('allows a fifth file but rejects a sixth', () => {
    expect(() => validateEventFile({type:'image/webp',size:1},4)).not.toThrow();
    expect(() => validateEventFile({type:'image/webp',size:1},5)).toThrow('Maximum 5');
  });
  it('only allows jpg, png, webp and pdf MIME types', () => {
    for (const type of ['image/jpeg','image/png','image/webp','application/pdf']) expect(() => validateEventFile({type,size:1},0)).not.toThrow();
    for (const type of ['image/gif','image/svg+xml','text/html']) expect(() => validateEventFile({type,size:1},0)).toThrow('Invalid event file');
  });
  it('orders upcoming events nearest first and keeps in-progress events', () => {
    const events=[event,{...event,id:'b',start_at:'2027-05-31T17:00:00Z',end_at:'2027-06-01T19:00:00Z'},{...event,id:'c',start_at:'2027-06-02T17:00:00Z'}];
    expect(filterEvents(events,false,'all','all',new Date('2027-06-01T16:00:00Z')).map(e=>e.id)).toEqual(['b',event.id,'c']);
  });
  it('orders past events newest first and applies category/organizer filters', () => {
    const events=[event,{...event,id:'b',category:'education',start_at:'2027-05-31T17:00:00Z'},{...event,id:'c',organizer:'MIFA',start_at:'2027-05-30T17:00:00Z'}];
    expect(filterEvents(events,true,'all','all',new Date('2027-06-02')).map(e=>e.id)).toEqual([event.id,'b','c']);
    expect(filterEvents(events,true,'dinner','MIFA',new Date('2027-06-02')).map(e=>e.id)).toEqual(['c']);
  });
  it('exports calendar timestamps in UTC and preserves cancellation state', () => {
    const ics=eventIcs({...event,status:'cancelled',title:'Meal, chat; welcome\nGuests'},'https://example.com/events/1',new Date('2027-01-01T00:00:00Z'));
    expect(ics).toContain('DTSTART:20270601T170000Z\r\n');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SUMMARY:Meal\\, chat\\; welcome\\nGuests');
    expect(ics).not.toContain('DTEND');
  });
});