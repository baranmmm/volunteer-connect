import { Link } from '@tanstack/react-router';
import { CalendarDays, MapPin, MessagesSquare, Utensils, HeartHandshake, Users, GraduationCap, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/i18n';
import type { HubEvent } from '@/lib/event-rules';
import { Badge } from '@/components/ui/badge';

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = ({ dialogue: MessagesSquare, dinner: Utensils, interfaith: HeartHandshake, community: Users, education: GraduationCap } as Record<string, typeof Tag>)[category] ?? Tag;
  return <Icon className={className} aria-hidden />;
}
export function EventCard({ event }: { event: HubEvent }) {
  const { t } = useTranslation();
  const cover = event.media.find(m => m.kind === 'image' && m.url);
  return <Link to="/events/$id" params={{ id: event.id }} data-testid="event-card" data-event-id={event.id} data-start={event.start_at} data-status={event.status} className="group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring sm:flex-row">
    <div data-testid="event-card-cover" className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-secondary text-secondary-foreground sm:aspect-square sm:w-36 sm:shrink-0">
      {cover?.url ? <img src={cover.url} alt={event.title} className="h-full w-full object-cover" loading="lazy" /> : <CategoryIcon category={event.category} className="size-12" />}
    </div>
    <div className="min-w-0 flex-1 space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="size-4" /><span>{formatDate(event.start_at, { dateStyle: 'medium' })} · {formatDate(event.start_at, { timeStyle: 'short' })}</span></div>
      <h2 className="break-words text-xl font-semibold group-hover:text-primary">{event.title}</h2>
      <div className="flex flex-wrap items-center gap-2"><span className="break-words text-sm">{event.organizer}</span><Badge variant="secondary">{t(`events.categories.${event.category}`)}</Badge>{event.status !== 'published' && <Badge variant={event.status === 'cancelled' ? 'destructive' : 'outline'}>{t(`events.${event.status}`)}</Badge>}</div>
      {event.location && <p className="flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" /><span className="break-words">{event.location}</span></p>}
    </div>
  </Link>;
}
