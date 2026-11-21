import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { RotateCcw, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listDeletedEvents, restoreEvent, deleteEvent } from '@/lib/delete-event.functions';
import { formatDate, translateError } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';

export function RecentlyDeletedEvents() {
  const { t } = useTranslation(), { session } = useAuth(), qc = useQueryClient();
  const fetch = useServerFn(listDeletedEvents), restore = useServerFn(restoreEvent), remove = useServerFn(deleteEvent);
  const [offset, setOffset] = useState(0), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const query = useQuery({ queryKey: ['events-deleted', session?.user.id, offset], queryFn: () => fetch({ data: { offset } }), staleTime: 0 });
  async function recover(id: string, title: string, pending: boolean) {
    setBusy(id); setError('');
    try {
      if (pending) await remove({ data: { id, title } });
      else await restore({ data: { id } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['events-deleted'] }), qc.invalidateQueries({ queryKey: ['events'] }), qc.invalidateQueries({ queryKey: ['event', id] })]);
      toast.success(t(pending ? 'events.deletedSuccess' : 'events.restoredSuccess'));
    } catch (e) { setError(translateError(e)); }
    finally { setBusy(null); }
  }
  return <section data-testid="events-recently-deleted" className="space-y-4 border-t pt-6">
    <h2 className="text-xl font-semibold">{t('events.recentlyDeleted')}</h2>
    <p className="text-sm text-muted-foreground">{t('events.restoreWindow')}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {query.isLoading ? <p>{t('common.loading')}</p> : query.isError ? <Button variant="outline" onClick={() => query.refetch()}>{t('common.retry')}</Button> : query.data?.length ? <ul className="divide-y">{query.data.map(e => <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><h3 className="break-words font-semibold">{e.title}</h3><p className="text-sm text-muted-foreground">{t('events.deletedOn', { date: formatDate(e.deleted_at) })}</p></div><Button data-testid={e.cleanup_pending ? 'event-delete-button' : 'event-restore-button'} variant="outline" disabled={busy !== null} onClick={() => void recover(e.id, e.title, e.cleanup_pending)}>{e.cleanup_pending ? <RefreshCw /> : <RotateCcw />}{t(e.cleanup_pending ? 'events.retryDeletion' : 'events.restoreEvent')}</Button></li>)}</ul> : <p className="text-muted-foreground">{t('events.noDeleted')}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={offset === 0 || busy !== null} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('events.previous')}</Button><Button variant="outline" disabled={(query.data?.length ?? 0) < 100 || busy !== null} onClick={() => setOffset(offset + 100)}>{t('events.next')}</Button></div>
  </section>;
}