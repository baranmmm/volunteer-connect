import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus, Share2, Pencil, X, MapPin, ChevronLeft, ChevronRight, FileText, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { getEvent, cancelEvent } from '@/lib/events.functions';
import { eventIcs } from '@/lib/event-rules';
import { formatDate, translateError } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { pageHead } from '@/components/app/head';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EventForm } from '@/components/events/EventForm';
import { EventDialog } from '@/components/events/EventDialog';
import { CategoryIcon } from '@/components/events/EventCard';

export const Route = createFileRoute('/_app/events_/$id')({ ssr:false, head:() => pageHead('Event details', 'View event details, private images and leaflets, and add Dialogue Society events to your calendar.'), component:EventDetail });
function EventDetail() {
  const { id } = Route.useParams(), { t } = useTranslation();
  const { session, profile } = useAuth();
  const fetch = useServerFn(getEvent), cancel = useServerFn(cancelEvent), qc = useQueryClient();
  const query = useQuery({ queryKey:['event',id,session?.user.id,profile?.status], queryFn:() => fetch({ data:{id} }), enabled: profile?.status === 'active', staleTime:240000, refetchInterval:240000 });
  const [editing,setEditing] = useState(false), [cancelling,setCancelling] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [image,setImage] = useState<number|null>(null), touch = useRef<number|null>(null);
  if (query.isLoading) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (query.isError) return <div role="alert" className="space-y-3"><p className="text-destructive">{t('events.loadError')}</p><Button variant="outline" onClick={() => query.refetch()}>{t('common.retry')}</Button></div>;
  if (!query.data?.event) return <div className="space-y-4"><p>{t('events.notFound')}</p><Button asChild variant="outline"><Link to="/calendar"><ArrowLeft />{t('events.back')}</Link></Button></div>;
  const { event, canManage } = query.data;
  const images = event.media.filter(m => m.kind === 'image' && m.url), pdfs = event.media.filter(m => m.kind === 'pdf' && m.url);
  const selected = image === null ? null : images[image];
  function next(delta: number) { setImage(current => current === null || !images.length ? null : (current+delta+images.length)%images.length); }
  const url = `${window.location.origin}/events/${event.id}`;
  function downloadCalendar() {
    const blob = new Blob([eventIcs(event,url)], { type:'text/calendar;charset=utf-8' });
    const object = URL.createObjectURL(blob), a = document.createElement('a'); a.href=object; a.download=`event-${event.id}.ics`; a.click(); setTimeout(() => URL.revokeObjectURL(object),1000);
  }
  async function confirmCancel() {
    setBusy(true); setError('');
    try { await cancel({ data:{id} }); await Promise.all([qc.invalidateQueries({ queryKey:['event',id] }),qc.invalidateQueries({ queryKey:['events'] })]); setCancelling(false); toast.success(t('events.cancelledSuccess')); }
    catch(e) { setError(translateError(e)); } finally { setBusy(false); }
  }
  return <article className="space-y-6">
    <Link to="/calendar" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />{t('events.back')}</Link>
    <header className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Badge data-testid="event-detail-category" variant="secondary">{t(`events.categories.${event.category}`)}</Badge><Badge data-testid="event-detail-status-badge" variant={event.status==='cancelled'?'destructive':'outline'}>{t(`events.${event.status}`)}</Badge></div><h1 data-testid="event-detail-title" className="break-words text-3xl font-bold sm:text-4xl">{event.title}</h1><p data-testid="event-detail-organizer" className="break-words text-lg text-muted-foreground">{event.organizer}</p></header>
    <section data-testid="event-detail-gallery" aria-label={t('events.gallery')} className="space-y-3">{images.length ? <div className="grid gap-3 sm:grid-cols-2">{images.map((m,i) => <Button key={m.id} variant="ghost" data-testid="event-detail-image" data-position={m.position} aria-label={t('events.imageNumber',{position:i+1,count:images.length})} className={`h-auto overflow-hidden rounded-lg p-0 ${i===0?'sm:col-span-2':''}`} onClick={() => setImage(i)}><img src={m.url ?? ''} alt={event.title} className={`w-full object-cover ${i===0?'max-h-[480px]':'aspect-[16/10]'}`} /></Button>)}</div> : <div className="flex h-36 items-center justify-center border-y bg-secondary text-secondary-foreground"><CategoryIcon category={event.category} className="size-14" /></div>}
      {pdfs.map((m,i) => <Button key={m.id} asChild variant="outline"><a data-testid="event-detail-pdf-link" href={m.url ?? ''} target="_blank" rel="noopener noreferrer"><FileText />{t('events.leaflet')}{pdfs.length>1?` ${i+1}`:''}</a></Button>)}
    </section>
    <div className="space-y-4 border-y py-5"><div className="flex items-start gap-3"><CalendarDays className="mt-1 size-5 shrink-0 text-primary" /><div><p className="font-semibold">{formatDate(event.start_at,{ dateStyle:'full' })}</p><p className="text-muted-foreground">{formatDate(event.start_at,{timeStyle:'short'})}{event.end_at ? ` – ${formatDate(event.end_at,{dateStyle:'medium',timeStyle:'short'})}` : ''}</p></div></div>
      {event.location && <a data-testid="event-detail-location-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 text-primary underline underline-offset-4"><MapPin className="mt-0.5 size-5 shrink-0" /><span className="break-words">{event.location}</span></a>}
      <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">{t('events.scope')}</dt><dd>{t(`events.${event.scope}`)}</dd></div>{query.data.branchName && <div><dt className="text-muted-foreground">{t('events.branch')}</dt><dd>{query.data.branchName}</dd></div>}<div><dt className="text-muted-foreground">{t('events.region')}</dt><dd>{query.data.regionName ?? '—'}</dd></div><div><dt className="text-muted-foreground">{t('events.capacity')}</dt><dd>{event.capacity ?? t('events.unlimited')}</dd></div></dl>
    </div>
    {event.description && <p className="whitespace-pre-wrap break-words leading-relaxed">{event.description}</p>}
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button data-testid="event-add-to-calendar-button" variant="outline" className="h-11" onClick={downloadCalendar}><CalendarPlus />{t('events.addCalendar')}</Button><Button asChild variant="outline" className="h-11"><a data-testid="event-share-whatsapp-button" href={`https://wa.me/?text=${encodeURIComponent(`${event.title}\n${formatDate(event.start_at,{dateStyle:'full',timeStyle:'short'})}\n${url}`)}`} target="_blank" rel="noopener noreferrer"><Share2 />{t('events.whatsapp')}</a></Button></div>
    {canManage && <section className="flex flex-col gap-2 border-t pt-5 sm:flex-row"><Button data-testid="event-edit-button" variant="outline" className="h-11" onClick={() => setEditing(true)}><Pencil />{t('events.edit')}</Button>{event.status!=='cancelled' && <Button data-testid="event-cancel-event-button" variant="outline" className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { setError('');setCancelling(true); }}><X />{t('events.cancelEvent')}</Button>}</section>}
    {editing && canManage && <EventForm event={event} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    <EventDialog open={cancelling && canManage} onClose={() => { if (!busy) setCancelling(false); }} title={t('events.cancelTitle')}><p className="text-muted-foreground">{t('events.cancelText')}</p>{error && <p role="alert" className="mt-3 text-destructive">{error}</p>}<div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => setCancelling(false)}>{t('events.keepEvent')}</Button><Button data-testid="confirm-dialog-confirm-button" variant="destructive" disabled={busy} onClick={confirmCancel}>{busy?t('common.saving'):t('events.cancelEvent')}</Button></div></EventDialog>
    <EventDialog open={image!==null && !!selected} onClose={() => setImage(null)} title={t('events.gallery')} testId="event-detail-lightbox" fullscreen><div className="flex min-h-0 flex-1 flex-col" tabIndex={0} onKeyDown={e => { if(e.key==='ArrowRight') next(1);if(e.key==='ArrowLeft') next(-1); }} onTouchStart={e => { touch.current=e.touches[0]?.clientX ?? null; }} onTouchEnd={e => { const end=e.changedTouches[0]?.clientX; if(touch.current!==null && end!==undefined && Math.abs(end-touch.current)>40) next(end<touch.current?1:-1);touch.current=null; }}><img src={selected?.url ?? ''} alt={event.title} className="min-h-0 w-full flex-1 object-contain" /><div className="mt-4 flex items-center justify-between"><Button variant="outline" size="icon" aria-label={t('events.previous')} onClick={() => next(-1)}><ChevronLeft /></Button><p className="text-sm text-muted-foreground">{t('events.imageNumber',{position:(image??0)+1,count:images.length})}</p><Button variant="outline" size="icon" aria-label={t('events.next')} onClick={() => next(1)}><ChevronRight /></Button></div></div></EventDialog>
  </article>;
}
