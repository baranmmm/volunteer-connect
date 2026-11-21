import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { CalendarDays, List, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { EVENT_CATEGORIES, filterEvents, londonInput } from '@/lib/event-rules';
import { listEvents } from '@/lib/events.functions';
import { pageHead } from '@/components/app/head';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EventCard } from '@/components/events/EventCard';
import { MonthEvents } from '@/components/events/MonthEvents';
import { EventForm } from '@/components/events/EventForm';
import { RecentlyDeletedEvents } from '@/components/events/RecentlyDeletedEvents';

export const Route = createFileRoute('/_app/calendar')({ ssr:false, head: () => pageHead('Calendar & Events', 'View Dialogue Society branch and regional events and manage your event calendar.'), component: CalendarPage });
function CalendarPage() {
  const { t } = useTranslation();
  const { session, profile, isManager, roles } = useAuth();
  const fetch = useServerFn(listEvents), navigate = useNavigate();
  const [view,setView] = useState<'month'|'list'>('list');
  useEffect(() => { setView(window.matchMedia('(max-width: 767px)').matches ? 'list' : 'month'); }, []);
  const [past,setPast] = useState(false), [category,setCategory] = useState('all'), [organizer,setOrganizer] = useState('all');
  const [month,setMonth] = useState(() => new Date(`${londonInput(new Date()).slice(0,7)}-01T12:00:00`));
  const [creating,setCreating] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Advance cached events through start/end boundaries without another network read.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const events = useQuery({ queryKey:['events',session?.user.id,profile?.status], queryFn:() => fetch(), enabled:profile?.status === 'active', staleTime:240000, refetchInterval:240000 });
  const filtered = filterEvents(events.data ?? [],view === 'month' ? null : past,category,organizer,now);
  const organizers = [...new Set((events.data ?? []).map(e => e.organizer))].sort();
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">{t('events.title')}</h1>{isManager && <Button data-testid="calendar-create-event-button" className="h-11" onClick={() => setCreating(true)}><Plus />{t('events.create')}</Button>}</header>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div data-testid="calendar-view-toggle" role="group" aria-label={t('events.title')} className="flex gap-1"><Button variant={view==='month'?'secondary':'ghost'} aria-pressed={view==='month'} onClick={() => setView('month')}><CalendarDays />{t('events.month')}</Button><Button variant={view==='list'?'secondary':'ghost'} aria-pressed={view==='list'} onClick={() => setView('list')}><List />{t('events.list')}</Button></div>
      {view === 'list' && <div className="flex flex-wrap gap-2"><Button data-testid="calendar-filter-upcoming" variant={!past?'default':'outline'} aria-pressed={!past} onClick={() => setPast(false)}>{t('events.upcoming')}</Button><Button data-testid="calendar-filter-past" variant={past?'default':'outline'} aria-pressed={past} onClick={() => setPast(true)}>{t('events.past')}</Button></div>}
    </div>
    <div className="grid gap-3 sm:grid-cols-2"><Select value={category} onValueChange={setCategory}><SelectTrigger data-testid="calendar-filter-category" aria-label={t('events.category')} className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('events.allCategories')}</SelectItem>{EVENT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{t(`events.categories.${c}`)}</SelectItem>)}</SelectContent></Select><Select value={organizer} onValueChange={setOrganizer}><SelectTrigger data-testid="calendar-filter-organizer" aria-label={t('events.organizer')} className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('events.allOrganizers')}</SelectItem>{organizers.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></div>
    {events.isLoading ? <p className="py-10 text-center text-muted-foreground">{t('common.loading')}</p> : events.isError ? <div role="alert" className="space-y-3"><p className="text-destructive">{t('events.loadError')}</p><Button variant="outline" onClick={() => events.refetch()}>{t('common.retry')}</Button></div> : view === 'month' ? <MonthEvents month={month} onMonth={setMonth} events={filtered} now={now} /> : <section data-testid="calendar-list-view" className="space-y-3">{filtered.length ? filtered.map(e => <EventCard key={e.id} event={e} now={now} />) : <p className="border-y py-12 text-center text-muted-foreground">{t('events.empty')}</p>}</section>}
    {creating && <EventForm onClose={() => setCreating(false)} onSaved={id => { setCreating(false); void navigate({ to:'/events/$id',params:{id} }); }} />}
    {view === 'month' && filtered.some(e => !e.start_at) && <section className="space-y-3"><h2 className="text-xl font-semibold">{t('events.unscheduled')}</h2>{filtered.filter(e => !e.start_at).map(e => <EventCard key={e.id} event={e} now={now} />)}</section>}
    {roles.includes('regional_director') && <RecentlyDeletedEvents />}
  </div>;
}
