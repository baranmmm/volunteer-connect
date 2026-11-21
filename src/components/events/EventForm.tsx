import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowUp, ArrowDown, Trash2, FileText, Image, Upload } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { EVENT_CATEGORIES, eventFileExtension, londonInput, londonToIso, MAX_EVENT_FILES, type HubEvent, type EventMedia } from '@/lib/event-rules';
import { prepareEventFile, uploadEventFile, removeStoredEventFile } from '@/lib/event-files';
import { saveEvent, eventBranches, reserveEventMedia, deleteEventMedia, reorderEventMedia } from '@/lib/events.functions';
import { translateError } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { EventDialog } from './EventDialog';

type Item = { key: string; name: string; kind: 'image' | 'pdf'; file?: File; media?: EventMedia; preview?: string };
export function EventForm({ event, onClose, onSaved }: { event?: HubEvent; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const { session, roles, profile } = useAuth();
  const director = roles.includes('regional_director');
  const qc = useQueryClient();
  const save = useServerFn(saveEvent), branchesFn = useServerFn(eventBranches), reserve = useServerFn(reserveEventMedia), remove = useServerFn(deleteEventMedia), reorder = useServerFn(reorderEventMedia);
  const branches = useQuery({ queryKey: ['event-branches', session?.user.id], queryFn: () => branchesFn() });
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [organizer, setOrganizer] = useState(event?.organizer ?? 'Dialogue Society');
  const initialCategory = EVENT_CATEGORIES.find(c => c === event?.category) ?? 'dialogue';
  const [category, setCategory] = useState<typeof initialCategory>(initialCategory);
  const [start, setStart] = useState(event ? londonInput(event.start_at) : '');
  const [end, setEnd] = useState(event?.end_at ? londonInput(event.end_at) : '');
  const [capacity, setCapacity] = useState(event?.capacity?.toString() ?? '');
  const [scope, setScope] = useState<'branch' | 'region'>(event?.scope === 'region' ? 'region' : 'branch');
  const [branch, setBranch] = useState(event?.branch_id ?? (director ? '' : profile?.branch_id ?? ''));
  const [items, setItems] = useState<Item[]>((event?.media ?? []).map(m => ({ key: m.id, name: m.storage_path.split('/').pop() ?? m.id, kind: m.kind === 'pdf' ? 'pdf' : 'image', media: m })));
  const attached = useRef<EventMedia[]>(event?.media ?? []);
  const [savedId, setSavedId] = useState(event?.id ?? null);
  const [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach(url => URL.revokeObjectURL(url)), []);
  const valid = !!title.trim() && !!organizer.trim() && !!start && (scope === 'region' || !!branch);
  async function addFiles(files: FileList | null) {
    if (!files) return;
    setPreparing(true); setError(''); setFileErrors([]);
    let next = [...items];
    const rejected: string[] = [];
    for (const original of Array.from(files)) {
      try {
        const file = await prepareEventFile(original, next.length);
        const kind = file.type === 'application/pdf' ? 'pdf' : 'image';
        const preview = kind === 'image' ? URL.createObjectURL(file) : undefined;
        if (preview) previews.current.push(preview);
        next.push({ key: crypto.randomUUID(), name: original.name, kind, file, ...(preview ? { preview } : {}) });
      } catch (e) { rejected.push(t('events.fileRejected', { name: original.name, reason: translateError(e) })); }
    }
    setFileErrors(rejected);
    // Never leave a PDF as cover when images are available.
    if (next[0]?.kind === 'pdf') { const i = next.findIndex(x => x.kind === 'image'); if (i > 0) { const [cover] = next.splice(i, 1); if (cover) next.unshift(cover); } }
    setItems(next); setPreparing(false);
  }
  function move(index: number, delta: number) {
    const next = [...items], item = next[index], other = next[index + delta];
    if (!item || !other) return;
    next[index] = other; next[index + delta] = item;
    if (next[0]?.kind === 'pdf' && next.some(x => x.kind === 'image')) { setError(t('events.orderError')); return; }
    setItems(next); setError('');
  }
  async function submit(status: 'draft' | 'published' | 'cancelled') {
    if (!valid || busy || preparing) return;
    setBusy(true); setError(''); setFileErrors([]);
    let id = savedId;
    try {
      const startIso = londonToIso(start), endIso = end ? londonToIso(end) : null;
      if (endIso && Date.parse(endIso) < Date.parse(startIso)) { setError(t('events.dateError')); return; }
      const data = { title, description, location, organizer, category, start_at: startIso, end_at: endIso, capacity: capacity ? Number(capacity) : null, scope, branch_id: scope === 'branch' ? branch : null, status };
      // Create a recoverable draft before uploading; publish only after all file operations succeed.
      if (!id) { id = await save({ data: { id: null, event: { ...data, status: 'draft' } } }); setSavedId(id); }
      for (const old of [...attached.current]) {
        if (!items.some(x => x.media?.id === old.id)) {
          await removeStoredEventFile(old.storage_path); await remove({ data: { id: old.id } });
          attached.current = attached.current.filter(m => m.id !== old.id);
        }
      }
      const completed: Item[] = [];
      for (const item of items) {
        if (item.file) {
          const extension = eventFileExtension(item.file.type);
          if (extension !== 'jpg' && extension !== 'png' && extension !== 'webp' && extension !== 'pdf') throw new Error('Invalid event file');
          let row: EventMedia | undefined;
          try {
            row = { ...await reserve({ data: { eventId: id, kind: item.kind, extension } }), url: null };
            await uploadEventFile(row.storage_path, item.file);
          } catch (e) {
            setFileErrors([t('events.fileRejected', { name: item.name, reason: translateError(e) })]);
            if (row) {
              await removeStoredEventFile(row.storage_path).catch(() => undefined);
              await remove({ data: { id: row.id } });
            }
            throw e;
          }
          const media = { ...row, url: item.preview ?? null };
          attached.current.push(media);
          const updated = { key: row.id, name: item.name, kind: item.kind, media, ...(item.preview ? { preview: item.preview } : {}) };
          completed.push(updated);
          setItems(current => current.map(x => x.key === item.key ? updated : x));
        } else completed.push(item);
      }
      let ordered = completed;
      if (ordered[0]?.kind === 'pdf') { const cover = ordered.find(x => x.kind === 'image'); if (cover) ordered = [cover, ...ordered.filter(x => x !== cover)]; }
      await reorder({ data: { eventId: id, ids: ordered.flatMap(x => x.media ? [x.media.id] : []) } });
      await save({ data: { id, event: data } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['events'] }), qc.invalidateQueries({ queryKey: ['event', id] })]);
      toast.success(t('events.saved')); onSaved(id);
    } catch (e) { setError(id ? `${t('events.partialError')} ${translateError(e)}` : translateError(e)); }
    finally { setBusy(false); }
  }
  function field(label: string, testId: string, value: string, setter: (value: string) => void, type = 'text', required = false) {
    return <div className="space-y-1.5"><Label htmlFor={testId}>{label}</Label><Input id={testId} data-testid={testId} type={type} value={value} onChange={e => setter(e.target.value)} required={required} disabled={busy} className="min-w-0 h-11" {...(type === 'number' ? { min: 1, step: 1, placeholder: t('events.unlimited') } : {})} {...(testId === 'event-form-title' || testId === 'event-form-organizer' ? { maxLength: 200 } : {})} /></div>;
  }
  return <EventDialog open onClose={() => { if (!busy && !preparing) onClose(); }} title={event ? t('events.edit') : t('events.create')}>
    <form data-testid="event-form" className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(event?.status === 'cancelled' ? 'cancelled' : 'published'); }}>
      {field(t('events.titleLabel'), 'event-form-title', title, setTitle, 'text', true)}
      <div className="space-y-1.5"><Label htmlFor="event-form-description">{t('events.description')}</Label><Textarea id="event-form-description" data-testid="event-form-description" value={description} onChange={e => setDescription(e.target.value)} disabled={busy} rows={3} /></div>
      {field(t('events.location'), 'event-form-location', location, setLocation)}
      <div className="grid gap-4 sm:grid-cols-2">{field(t('events.organizer'), 'event-form-organizer', organizer, setOrganizer, 'text', true)}
        <div className="space-y-1.5"><Label>{t('events.category')}</Label><Select value={category} disabled={busy} onValueChange={v => { const c = EVENT_CATEGORIES.find(x => x === v); if (c) setCategory(c); }}><SelectTrigger data-testid="event-form-category" aria-label={t('events.category')} className="h-11"><SelectValue /></SelectTrigger><SelectContent>{EVENT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{t(`events.categories.${c}`)}</SelectItem>)}</SelectContent></Select></div>
        {field(t('events.start'), 'event-form-start', start, setStart, 'datetime-local', true)}{field(t('events.end'), 'event-form-end', end, setEnd, 'datetime-local')}
        {director && <div className="space-y-1.5"><Label>{t('events.scope')}</Label><Select value={scope} disabled={busy} onValueChange={v => setScope(v === 'region' ? 'region' : 'branch')}><SelectTrigger data-testid="event-form-scope" aria-label={t('events.scope')} className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="branch">{t('events.branch')}</SelectItem><SelectItem value="region">{t('events.region')}</SelectItem></SelectContent></Select></div>}
        {scope === 'branch' && <div className="space-y-1.5"><Label>{t('events.branch')}</Label><Select value={branch} onValueChange={setBranch} disabled={busy || branches.isLoading}><SelectTrigger data-testid="event-form-branch" aria-label={t('events.branch')} className="h-11"><SelectValue placeholder={t('auth.chooseBranch')} /></SelectTrigger><SelectContent>{(branches.data ?? []).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>}
        {field(t('events.capacity'), 'event-form-capacity', capacity, setCapacity, 'number')}
      </div>
      {branches.isError && <p role="alert" className="text-sm text-destructive">{t('errors.branchesLoad')}</p>}
      <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">{t('events.files')}</h3><p className="text-xs text-muted-foreground">{t('events.fileLimits')}</p>
        <Label htmlFor="event-form-file-input" className="flex min-h-11 items-center gap-2 text-primary"><Upload className="size-4" />{t('events.files')}</Label><Input id="event-form-file-input" data-testid="event-form-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={busy || preparing || items.length >= MAX_EVENT_FILES} onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
        {preparing && <p role="status" className="text-sm text-muted-foreground">{t('events.filePreparing')}</p>}
        <ol className="space-y-2">{items.map((item, i) => <li key={item.key} data-testid="event-form-file-item" data-position={i} className="flex min-w-0 flex-wrap items-center gap-2 border-b py-2">
          {(item.preview ?? item.media?.url) && item.kind === 'image' ? <img src={item.preview ?? item.media?.url ?? ''} alt="" className="size-12 rounded-md object-cover" /> : item.kind === 'pdf' ? <FileText className="size-6 text-muted-foreground" /> : <Image className="size-6 text-muted-foreground" />}
          <span className="min-w-0 flex-1 break-all text-xs">{item.name}{i === 0 && item.kind === 'image' && <span className="ml-2 font-semibold text-primary">{t('events.cover')}</span>}</span>
          <div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" disabled={busy || preparing || i === 0} aria-label={t('events.moveUp')} title={t('events.moveUp')} onClick={() => move(i,-1)}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon" disabled={busy || preparing || i === items.length-1} aria-label={t('events.moveDown')} title={t('events.moveDown')} onClick={() => move(i,1)}><ArrowDown /></Button><Button data-testid="event-form-file-remove" type="button" variant="ghost" size="icon" disabled={busy || preparing} aria-label={t('events.remove')} title={t('events.remove')} onClick={() => setItems(items.filter((_, index) => index !== i))}><Trash2 /></Button></div>
        </li>)}</ol>
      </section>
      {fileErrors.length > 0 && <ul data-testid="event-form-file-errors" role="alert" className="space-y-1 text-sm text-destructive">{fileErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {error && <p data-testid="event-form-error" role="alert" className="text-sm text-destructive">{error}</p>}
      {savedId && error && <Button asChild variant="link"><Link to="/events/$id" params={{ id: savedId }}>{t('events.openSaved')}</Link></Button>}
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">{event?.status !== 'cancelled' && <Button data-testid="event-form-save-draft" type="button" variant="outline" disabled={!valid || busy || preparing} onClick={() => void submit('draft')}>{busy ? t('common.saving') : t('events.saveDraft')}</Button>}<Button data-testid="event-form-publish" type="submit" disabled={!valid || busy || preparing}>{busy ? t('common.saving') : event?.status === 'cancelled' ? t('common.save') : t('events.publish')}</Button></div>
    </form>
  </EventDialog>;
}
