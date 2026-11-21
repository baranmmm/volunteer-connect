import { addDays, addMonths, endOfMonth, endOfWeek, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { dateLocale, formatDate } from '@/lib/i18n';
import { londonInput, type HubEvent } from '@/lib/event-rules';

export function MonthEvents({ events, month, onMonth }: { events: HubEvent[]; month: Date; onMonth: (date: Date) => void }) {
  const { t, i18n } = useTranslation();
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const last = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let day = first; day <= last; day = addDays(day,1)) days.push(day);
  const key = (day: Date) => `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  const today = londonInput(new Date()).slice(0,10);
  return <section data-testid="calendar-month-view" className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{new Intl.DateTimeFormat(dateLocale(i18n.language), { month:'long', year:'numeric' }).format(month)}</h2><div className="flex gap-1"><Button variant="outline" size="icon" aria-label={t('events.previous')} title={t('events.previous')} onClick={() => onMonth(addMonths(month,-1))}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label={t('events.next')} title={t('events.next')} onClick={() => onMonth(addMonths(month,1))}><ChevronRight /></Button></div></div>
    <div className="overflow-x-auto"><div className="grid min-w-[630px] grid-cols-7 border-l border-t">
      {days.slice(0,7).map(day => <div key={key(day)} className="border-b border-r bg-secondary p-2 text-center text-xs font-semibold text-secondary-foreground">{new Intl.DateTimeFormat(dateLocale(i18n.language), { weekday:'short' }).format(day)}</div>)}
      {days.map(day => <div key={key(day)} className={`min-h-28 min-w-0 border-b border-r p-2 ${isSameMonth(day,month) ? 'bg-card' : 'bg-muted/50'}`}><span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${key(day) === today ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{day.getDate()}</span><div className="mt-1 space-y-1">{events.filter(e => e.start_at && londonInput(e.start_at).slice(0,10) === key(day)).map(e => <Link key={e.id} to="/events/$id" params={{ id:e.id }} data-testid="event-card" data-event-id={e.id} data-start={e.start_at} data-status={e.status} className={`block break-words rounded-md border-l-2 p-1 text-xs hover:bg-accent ${e.status === 'cancelled' ? 'border-destructive bg-destructive/10' : 'border-primary bg-secondary'}`}><span className="block font-medium">{e.start_at ? formatDate(e.start_at, { timeStyle:'short' }) : ''}</span>{e.title}{e.status !== 'published' && <span className="mt-1 block text-muted-foreground">{t(`events.${e.status}`)}</span>}</Link>)}</div></div>)}
    </div></div>
  </section>;
}
