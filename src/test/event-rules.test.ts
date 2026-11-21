import { describe, expect, it } from 'vitest';
import { eventIcs, filterEvents, imageDimensions, londonInput, londonToIso, validateEventFile, type HubEvent } from '@/lib/event-rules';

const event: HubEvent = { id:'11111111-1111-4111-8111-111111111111', title:'Community dinner',description:'A shared meal',location:'London',organizer:'Dialogue Society',category:'dinner',start_at:'2027-06-01T17:00:00Z',end_at:null,capacity:null,scope:'branch',branch_id:null,region_id:'r',status:'published',created_by:null,created_at:'',updated_at:'',media:[] };
describe('event rules', () => {
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