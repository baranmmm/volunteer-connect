import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { listRecycleBin, restoreRecycleItem, permanentlyDeleteRecycleItem } from '@/lib/recycle-bin.functions';
import type { RecycleRow } from '@/lib/recycle-bin';
import { formatDate, translateError } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { pageHead } from '@/components/app/head';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const Route = createFileRoute('/_app/recycle-bin')({
  ssr: false,
  head: () => pageHead('Recycle Bin', 'Restore or permanently delete Dialogue Society events and accounts within your permitted branch or region.'),
  component: RecycleBinPage,
});

function RecycleBinPage() {
  const { t } = useTranslation(), { isManager, profile, session } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(listRecycleBin), restore = useServerFn(restoreRecycleItem), remove = useServerFn(permanentlyDeleteRecycleItem);
  const [type, setType] = useState<'all' | 'event' | 'user'>('all'), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [target, setTarget] = useState<RecycleRow | null>(null), [typed, setTyped] = useState('');
  const allowed = isManager && profile?.status === 'active';
  const query = useQuery({
    queryKey: ['recycle-bin', session?.user.id, profile?.status, type, search, offset],
    queryFn: () => list({ data: { type, search, offset } }), enabled: allowed, staleTime: 0,
  });
  async function act(item: RecycleRow, permanent = false) {
    if (permanent && typed !== 'DELETE') return;
    setBusy(item.id); setError('');
    try {
      if (permanent) await remove({ data: { type: item.type, id: item.id, confirmation: 'DELETE' } });
      else await restore({ data: { type: item.type, id: item.id } });
      setTarget(null); setTyped('');
      qc.removeQueries({ queryKey: ['event', item.id] });
      qc.removeQueries({ queryKey: ['member', item.id] });
      await Promise.all(['recycle-bin', 'events', 'members', 'member-history', 'deletion-requests'].map(key => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(t(permanent ? 'recycleBin.permanentlyDeleted' : 'recycleBin.restored'));
    } catch (e) { setError(translateError(e)); }
    finally { setBusy(null); }
  }
  if (!allowed) return <div role="alert" className="space-y-2"><h1 className="text-2xl font-bold">{t('userDetails.notAllowedTitle')}</h1><p className="text-muted-foreground">{t('errors.notAllowed')}</p></div>;
  const rows = query.data ?? [], total = rows[0]?.total_count ?? 0;
  return <div className="space-y-6">
    <header className="space-y-2"><h1 className="flex items-center gap-3 text-3xl font-bold"><Trash2 className="size-7 text-primary" />{t('navigation.recycleBin')}</h1><p className="text-sm text-muted-foreground">{t('recycleBin.note')}</p></header>
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row">
      <Select value={type} onValueChange={value => { if (value === 'all' || value === 'event' || value === 'user') { setType(value); setOffset(0); } }}>
        <SelectTrigger data-testid="recycle-bin-type-filter" aria-label={t('recycleBin.typeFilter')} className="h-11 sm:w-48"><SelectValue /></SelectTrigger>
        <SelectContent>{(['all', 'event', 'user'] as const).map(value => <SelectItem key={value} value={value}>{t(`recycleBin.filters.${value}`)}</SelectItem>)}</SelectContent>
      </Select>
      <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input data-testid="recycle-bin-search" aria-label={t('recycleBin.search')} placeholder={t('recycleBin.search')} className="h-11 pl-9" maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></div>
    </div>
    {error && !target && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {query.isError ? <div role="alert" className="space-y-3"><p className="text-destructive">{translateError(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>{t('common.retry')}</Button></div> : <div className="overflow-x-auto border-y">
      <table data-testid="recycle-bin-table" className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground"><tr>{['item', 'branchRegion', 'deletedBy', 'deletedOn', 'daysLeft', 'actions'].map(key => <th key={key} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{t(`recycleBin.${key}`)}</th>)}</tr></thead>
        <tbody className="divide-y">{query.isLoading ? <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">{t('common.loading')}</td></tr> : rows.length ? rows.map(item => <tr key={`${item.type}-${item.id}`} data-testid="recycle-bin-row" data-item-id={item.id} data-item-type={item.type} data-self-requested={item.self_requested ? 'true' : 'false'} className="align-top">
          <td className="min-w-44 max-w-64 px-3 py-4"><p className="break-words font-semibold">{item.type === 'series' ? t('recycleBin.seriesTitle', { title: item.title, count: item.event_count ?? 0 }) : item.title || t('common.unnamed')}</p><div className="mt-1 flex flex-wrap gap-1"><Badge variant="secondary">{t(`recycleBin.types.${item.type}`)}</Badge>{item.role && <Badge variant="outline">{t(`common.roles.${item.role}`)}</Badge>}</div>{item.self_requested && <p data-testid="recycle-bin-scheduled-erasure" className="mt-2 text-xs text-muted-foreground">{t('recycleBin.scheduledErasure')}</p>}</td>
          <td className="min-w-32 px-3 py-4"><p>{item.branch ?? t('common.noBranch')}</p><p className="text-xs text-muted-foreground">{item.region}</p></td>
          <td className="min-w-28 px-3 py-4">{item.deleted_by_name ?? t('common.formerMember')}</td>
          <td className="whitespace-nowrap px-3 py-4">{formatDate(item.deleted_at)}</td>
          <td className="whitespace-nowrap px-3 py-4">{t('recycleBin.days', { count: item.days_left })}</td>
          <td className="px-3 py-4"><div className="flex flex-col items-start gap-2">{item.can_restore && <Button data-testid="recycle-bin-restore" variant="outline" disabled={busy !== null} onClick={() => void act(item)}><RotateCcw className="size-4" />{t('recycleBin.restore')}</Button>}<Button data-testid="recycle-bin-delete-permanently" variant="outline" className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy !== null} onClick={() => { setTarget(item); setTyped(''); setError(''); }}><Trash2 className="size-4" />{t('recycleBin.deletePermanently')}</Button></div></td>
        </tr>) : <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">{t('recycleBin.empty')}</td></tr>}</tbody>
      </table>
    </div>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={offset === 0 || busy !== null} onClick={() => setOffset(Math.max(0, offset - 50))}>{t('events.previous')}</Button><Button variant="outline" disabled={offset + rows.length >= total || busy !== null} onClick={() => setOffset(offset + 50)}>{t('events.next')}</Button></div>
    <Dialog open={target !== null} onOpenChange={open => { if (!open && !busy) { setTarget(null); setTyped(''); setError(''); } }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg"><DialogHeader><DialogTitle>{t('recycleBin.permanentTitle')}</DialogTitle><DialogDescription>{t('recycleBin.permanentText', { title: target?.title })}</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="recycle-bin-confirm-input">{t('recycleBin.typeDelete')}</Label><Input id="recycle-bin-confirm-input" data-testid="recycle-bin-confirm-input" autoComplete="off" value={typed} disabled={busy !== null} onChange={e => setTyped(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button variant="outline" disabled={busy !== null} onClick={() => setTarget(null)}>{t('common.cancel')}</Button><Button data-testid="recycle-bin-confirm-delete" variant="destructive" disabled={busy !== null || typed !== 'DELETE'} onClick={() => { if (target) void act(target, true); }}><Trash2 />{busy ? t('events.deleting') : t('recycleBin.deletePermanently')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}