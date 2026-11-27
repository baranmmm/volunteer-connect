import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FileText, Plus, Upload, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { EventDialog } from "@/components/events/EventDialog";
import { DateTimeField } from "@/components/events/DateTimeField";
import { ScopeSelect } from "@/components/work/ScopeSelect";
import { PeopleCombobox } from "@/components/work/PeopleCombobox";
import { useWorkScopes } from "@/components/work/use-work-scopes";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { londonInput, londonToIso } from "@/lib/event-rules";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  MEETING_FILE_ACCEPT,
  MEETING_REPEAT_FREQS,
  validateMeetingFile,
  validateMeetingForm,
  type CarryOverChoice,
  type MeetingDetail,
  type MeetingFormErrors,
  type MeetingInput,
  type MeetingRecurrence,
  type MeetingSeriesMode,
} from "@/lib/meetings";
import {
  carryOverAgenda,
  createMeeting,
  deleteMeetingFile,
  listMeetingPeople,
  reserveMeetingFile,
  updateMeetingSeries,
} from "@/lib/meetings.functions";
import { listMyWorkScopes, scopeKey, type WorkScopeOption } from "@/lib/work-scopes";
import { MeetingCarryOver } from "./MeetingCarryOver";
import { MeetingScopeDialog } from "./MeetingScopeDialog";
import { inviteesHeader, meetingRecurrenceError } from "./meeting-ui";
import { uploadMeetingFiles } from "./meeting-upload";

type Props = {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit" | "approve";
  meeting?: MeetingDetail;
  initial?: { title?: string; description?: string | null; starts_at?: string; ends_at?: string };
  submit?: (input: MeetingInput) => Promise<string>;
  onSaved?: (meetingId: string) => void;
  testId?: string;
  /**
   * Edit only, for an occurrence of a recurring meeting: apply the change to these occurrences without asking. When
   * left out, the form asks (this / this and following / all) before saving.
   */
  seriesMode?: MeetingSeriesMode;
};

const MAX_FORM_AGENDA = 30;
type Repeat = "none" | MeetingRecurrence["freq"];

/**
 * Create, edit or (from a meeting request) approve a meeting. The database checks scope, invitees and edit rights
 * again; in "approve" mode it uses the request's scope and invites the requester, so both pickers are hidden.
 * The scope field shows only when the user can create in more than one scope (useWorkScopes().single hides it).
 * Visible: title, start/end (end follows start + 1 hour), place and invitees (a collapsed section whose header shows the
 * count and the first names: meeting-form-invitees-toggle, aria-expanded). "More options" (collapsed on every open)
 * holds the description and, when creating, agenda titles, files (uploaded once the meeting exists) and repetition.
 * Editing an occurrence of a recurring meeting asks which occurrences change (updateMeetingSeries).
 */
export function MeetingFormDialog(props: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const title =
    props.mode === "edit"
      ? t("meetings.form.editTitle")
      : props.mode === "approve"
        ? t("meetings.form.approveTitle")
        : t("meetings.form.createTitle");
  return (
    <EventDialog
      open={props.open}
      onClose={() => {
        if (!busy) props.onClose();
      }}
      title={title}
      testId={`${props.testId ?? "meeting-form"}-dialog`}
    >
      {props.open && <MeetingForm {...props} busy={busy} setBusy={setBusy} />}
    </EventDialog>
  );
}

const split = (iso?: string | null) => {
  const local = iso ? londonInput(iso) : "";
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
};
const toIso = (day: string, time: string) => {
  if (!day || !time) return null;
  try {
    return londonToIso(`${day}T${time}`);
  } catch {
    return undefined; // a London time that does not exist (clocks going forward)
  }
};

function MeetingForm({
  mode,
  meeting,
  initial,
  submit,
  onSaved,
  onClose,
  testId = "meeting-form",
  seriesMode,
  busy,
  setBusy,
}: Props & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const fetchScopes = useServerFn(listMyWorkScopes),
    fetchPeople = useServerFn(listMeetingPeople),
    create = useServerFn(createMeeting),
    carryOver = useServerFn(carryOverAgenda),
    updateSeries = useServerFn(updateMeetingSeries),
    reserve = useServerFn(reserveMeetingFile),
    removeFileRow = useServerFn(deleteMeetingFile);
  const source = mode === "edit" ? meeting : undefined;

  const [scope, setScope] = useState<WorkScopeOption | null>(
    source
      ? {
          scope: source.scope,
          branch_id: source.branch_id,
          region_id: source.region_id,
          label:
            source.scope === "branch"
              ? source.branch
              : source.scope === "region"
                ? source.region
                : null,
        }
      : null,
  );
  const scopes = useQuery({
    queryKey: ["work-scopes", uid],
    queryFn: () => fetchScopes(),
    enabled: mode === "create" && !!uid,
    staleTime: 60000,
  });
  const effectiveScope = mode === "create" ? (scope ?? scopes.data?.[0] ?? null) : scope;
  // One possible scope: it is used without showing a "Where" field.
  const { single } = useWorkScopes();

  const [titleValue, setTitle] = useState(source?.title ?? initial?.title ?? "");
  const [description, setDescription] = useState(source?.description ?? initial?.description ?? "");
  const s0 = split(source?.starts_at ?? initial?.starts_at),
    e0 = split(source?.ends_at ?? initial?.ends_at);
  const [startDay, setStartDay] = useState(s0.day),
    [startTime, setStartTime] = useState(s0.time),
    [endDay, setEndDay] = useState(e0.day),
    [endTime, setEndTime] = useState(e0.time);
  // End follows Start + 1 hour until the user edits End themselves.
  const endTouched = useRef(!!(source?.ends_at ?? initial?.ends_at));
  function setStart(day: string, time: string) {
    setStartDay(day);
    setStartTime(time);
    if (endTouched.current) return;
    const iso = toIso(day, time);
    if (!iso) return;
    const next = split(new Date(Date.parse(iso) + 3600000).toISOString());
    setEndDay(next.day);
    setEndTime(next.time);
  }
  function setEnd(day: string, time: string) {
    endTouched.current = true;
    setEndDay(day);
    setEndTime(time);
  }
  const [locationType, setLocationType] = useState<"in_person" | "online">(
    source?.location_type ?? "in_person",
  );
  const [location, setLocation] = useState(source?.location ?? "");
  const [onlineUrl, setOnlineUrl] = useState(source?.online_url ?? "");
  const [invitees, setInvitees] = useState<string[]>(source?.invitees.map((p) => p.id) ?? []);

  const showPeople = mode !== "approve" && !!effectiveScope;
  const people = useQuery({
    queryKey: ["meeting-people", uid, effectiveScope ? scopeKey(effectiveScope) : null],
    queryFn: () =>
      fetchPeople({
        data: {
          scope: effectiveScope!.scope,
          branchId: effectiveScope!.branch_id,
          regionId: effectiveScope!.region_id,
        },
      }),
    enabled: showPeople && !!uid,
    staleTime: 60000,
  });
  // Current invitees stay listed even when they are no longer in the scope's list, so they can be removed.
  const peopleList = useMemo(() => {
    const list = people.data ?? [];
    const extra = (source?.invitees ?? []).filter((p) => !list.some((x) => x.id === p.id));
    return [...list, ...extra];
  }, [people.data, source?.invitees]);

  // Invitees: collapsed on every open; the header names the first three.
  const [inviteesOpen, setInviteesOpen] = useState(false);
  const inviteeNames = useMemo(() => {
    const byId = new Map(peopleList.map((p) => [p.id, p.full_name]));
    return invitees.map((id) => byId.get(id) ?? t("common.formerMember"));
  }, [invitees, peopleList, t]);

  // More options: collapsed on every open.
  const [more, setMore] = useState(false);
  const [agenda, setAgenda] = useState<string[]>([]);
  // Carry-over from earlier meetings of the same place (create only): applied once the meeting exists.
  const [carry, setCarry] = useState<CarryOverChoice[]>([]);
  const [agendaDraft, setAgendaDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatCount, setRepeatCount] = useState("4");
  const [repeatError, setRepeatError] = useState("");
  // Editing an occurrence: the input waits here while the scope is chosen.
  const [pending, setPending] = useState<MeetingInput | null>(null);
  const [scopeError, setScopeError] = useState("");
  // Created, but some files were rejected: the form shows them and only offers to continue.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const [errors, setErrors] = useState<MeetingFormErrors>({});
  const [error, setError] = useState("");
  const errorId = (key: keyof MeetingFormErrors) =>
    errors[key] ? `${testId}-${key}-error` : undefined;
  function fieldError(key: keyof MeetingFormErrors): ReactNode {
    const message = errors[key];
    return message ? (
      <p
        id={`${testId}-${key}-error`}
        data-testid={`${testId}-${key}-error`}
        role="alert"
        className="text-sm text-destructive"
      >
        {t(message)}
      </p>
    ) : null;
  }

  function addAgendaTitle() {
    const value = agendaDraft.trim().slice(0, 200);
    if (!value || agenda.length >= MAX_FORM_AGENDA) return;
    setAgenda([...agenda, value]);
    setAgendaDraft("");
  }
  function pickFiles(list: FileList | null) {
    const rejected: string[] = [];
    const next = [...files];
    for (const file of Array.from(list ?? [])) {
      const reason = validateMeetingFile(file, next.length);
      if (reason)
        rejected.push(t("meetings.files.rejected", { name: file.name, reason: t(reason) }));
      else next.push(file);
    }
    setFiles(next);
    setFileErrors(rejected);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function finish(id: string, message: string) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["meetings"] }),
      qc.invalidateQueries({ queryKey: ["meeting"] }),
      qc.invalidateQueries({ queryKey: ["meeting-series-tasks"] }),
      // Every meeting is also a calendar entry.
      qc.invalidateQueries({ queryKey: ["events"] }),
    ]);
    toast.success(message);
    setBusy(false);
    onSaved?.(id);
    onClose();
  }

  async function save(input: MeetingInput, scopeMode: MeetingSeriesMode | null) {
    setError("");
    setScopeError("");
    setBusy(true);
    try {
      if (mode === "edit" && source) {
        const { count } = await updateSeries({
          data: { id: source.id, mode: scopeMode ?? "this", meeting: input },
        });
        setPending(null);
        return await finish(
          source.id,
          count > 1 ? t("meetings.form.updatedMany", { count }) : t("meetings.form.updated"),
        );
      }
      if (submit) return await finish(await submit(input), t("meetings.form.created"));
      const s = effectiveScope!;
      const count = repeat === "none" ? 1 : Number(repeatCount);
      const id = await create({
        data: {
          ...input,
          scope: s.scope,
          branch_id: s.branch_id,
          region_id: s.region_id,
          ...(agenda.length ? { agenda } : {}),
          ...(repeat !== "none"
            ? { recurrence: { freq: repeat, interval: repeatInterval, count } }
            : {}),
        },
      });
      const created =
        count > 1 ? t("meetings.form.createdSeries", { count }) : t("meetings.form.created");
      if (carry.length) {
        // One transaction for every chosen item (copies, task moves); the meeting stays if it is refused.
        try {
          const { count: carried } = await carryOver({ data: { meetingId: id, items: carry } });
          toast.success(t("meetings.carry.done", { count: carried }));
        } catch (e) {
          toast.error(translateError(e));
        }
        await qc.invalidateQueries({ queryKey: ["meeting-carry-over"] });
      }
      if (files.length) {
        // Files go to the (first) meeting once it exists; a rejected file does not undo the meeting.
        const { failed } = await uploadMeetingFiles({
          meetingId: id,
          files,
          existing: 0,
          reserve,
          removeRow: removeFileRow,
          t,
        });
        if (failed.length) {
          await qc.invalidateQueries({ queryKey: ["meetings"] });
          toast.success(created);
          setFileErrors(failed);
          setCreatedId(id);
          setBusy(false);
          return;
        }
      }
      await finish(id, created);
    } catch (e) {
      const message = translateError(e);
      if (pending) setScopeError(message);
      else setError(message);
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (createdId) {
      onSaved?.(createdId);
      onClose();
      return;
    }
    setError("");
    const startIso = toIso(startDay, startTime),
      endIso = toIso(endDay, endTime);
    const found = validateMeetingForm({
      title: titleValue,
      start: startIso ? new Date(startIso) : null,
      end: endIso ? new Date(endIso) : null,
      location_type: locationType,
      location,
      online_url: onlineUrl,
    });
    if (startIso === undefined) found.start = "meetings.errors.start";
    if (endIso === undefined) found.end = "meetings.errors.end";
    setErrors(found);
    const repeatKey =
      mode === "create" && repeat !== "none" && startIso
        ? meetingRecurrenceError(startIso, {
            freq: repeat,
            interval: repeatInterval,
            count: Number(repeatCount),
          })
        : null;
    setRepeatError(repeatKey ?? "");
    if (repeatKey) setMore(true);
    if (Object.keys(found).length || repeatKey || !startIso || !endIso) return;
    if (mode === "create" && !effectiveScope) return;
    const input: MeetingInput = {
      title: titleValue.trim(),
      description: description.trim() || null,
      starts_at: startIso,
      ends_at: endIso,
      location_type: locationType,
      location: locationType === "in_person" ? location.trim() : null,
      online_url: locationType === "online" ? onlineUrl.trim() : null,
      ...(mode !== "approve" ? { invitee_ids: invitees } : {}),
    };
    // An occurrence of a recurring meeting: ask which occurrences change, unless the caller already chose.
    if (mode === "edit" && source?.series_id && !seriesMode) {
      setScopeError("");
      setPending(input);
      return;
    }
    await save(input, seriesMode ?? null);
  }

  const input = (
    key: "title" | "location" | "online_url",
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    maxLength: number,
    type = "text",
  ) => (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label} *</Label>
      <Input
        id={id}
        data-testid={id}
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(e) => setter(e.target.value)}
        aria-required
        aria-invalid={!!errors[key]}
        aria-describedby={errorId(key)}
        disabled={busy}
        className="h-11 min-w-0"
      />
      {fieldError(key)}
    </div>
  );

  const agendaSection = (
    <div className="min-w-0 space-y-2" data-testid={`${testId}-agenda`} data-count={agenda.length}>
      <Label htmlFor={`${testId}-agenda-input`}>{t("meetings.form.agenda")}</Label>
      {agenda.length > 0 && (
        <ol className="grid min-w-0 grid-cols-1 gap-1">
          {agenda.map((item, i) => (
            <li
              key={`${i}-${item}`}
              data-testid={`${testId}-agenda-item`}
              className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-1 text-sm sm:py-0.5"
            >
              <span className="shrink-0 text-muted-foreground" aria-hidden>
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0 sm:size-8"
                data-testid={`${testId}-agenda-remove`}
                aria-label={t("meetings.form.agendaRemove", { title: item })}
                disabled={busy || !!createdId}
                onClick={() => setAgenda(agenda.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex min-w-0 gap-2">
        <Input
          id={`${testId}-agenda-input`}
          data-testid={`${testId}-agenda-input`}
          value={agendaDraft}
          maxLength={200}
          placeholder={t("meetings.form.agendaPlaceholder")}
          disabled={busy || !!createdId || agenda.length >= MAX_FORM_AGENDA}
          onChange={(e) => setAgendaDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAgendaTitle();
            }
          }}
          className="h-11 min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0"
          data-testid={`${testId}-agenda-add`}
          disabled={busy || !!createdId || !agendaDraft.trim() || agenda.length >= MAX_FORM_AGENDA}
          onClick={addAgendaTitle}
        >
          <Plus />
          {t("meetings.form.agendaAdd")}
        </Button>
      </div>
    </div>
  );

  const filesSection = (
    <div className="min-w-0 space-y-2" data-testid={`${testId}-files`} data-count={files.length}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("meetings.files.title")}</span>
        <input
          ref={fileInput}
          data-testid={`${testId}-files-input`}
          type="file"
          multiple
          accept={MEETING_FILE_ACCEPT}
          aria-label={t("meetings.form.filesPick")}
          tabIndex={-1}
          className="sr-only"
          disabled={busy || !!createdId}
          onChange={(e) => pickFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid={`${testId}-files-pick`}
          disabled={busy || !!createdId}
          onClick={() => fileInput.current?.click()}
        >
          <Upload />
          {t("meetings.form.filesPick")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("meetings.form.filesHint")}</p>
      {files.length > 0 && (
        <ul className="grid min-w-0 grid-cols-1 gap-1.5">
          {files.map((file, i) => (
            <li
              key={`${i}-${file.name}`}
              data-testid={`${testId}-file`}
              className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={file.name}>
                {file.name}
              </span>
              {!createdId && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  data-testid={`${testId}-file-remove`}
                  aria-label={t("meetings.files.delete", { name: file.name })}
                  disabled={busy}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const repeatSection = (
    <fieldset className="min-w-0 space-y-3" disabled={busy || !!createdId}>
      <legend className="mb-1.5 text-sm font-medium">{t("meetings.repeat.label")}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {(["none", ...MEETING_REPEAT_FREQS] as const).map((value) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`${testId}-repeat`}
              className="size-4"
              data-testid={`${testId}-repeat-${value}`}
              checked={repeat === value}
              onChange={() => {
                setRepeat(value);
                setRepeatError("");
              }}
            />
            {t(`meetings.repeat.${value}`)}
          </label>
        ))}
      </div>
      {repeat !== "none" && (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${testId}-repeat-interval`}>{t("meetings.repeat.every")}</Label>
            <select
              id={`${testId}-repeat-interval`}
              data-testid={`${testId}-repeat-interval`}
              value={repeatInterval}
              onChange={(e) => {
                setRepeatInterval(Number(e.target.value));
                setRepeatError("");
              }}
              className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {t(`meetings.repeat.${repeat}Every`, { count: n })}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${testId}-repeat-count`}>{t("meetings.repeat.count")}</Label>
            <Input
              id={`${testId}-repeat-count`}
              data-testid={`${testId}-repeat-count`}
              type="number"
              inputMode="numeric"
              min={2}
              max={52}
              value={repeatCount}
              aria-invalid={!!repeatError}
              aria-describedby={repeatError ? `${testId}-repeat-error` : undefined}
              onChange={(e) => {
                setRepeatCount(e.target.value);
                setRepeatError("");
              }}
              className="h-11 min-w-0"
            />
          </div>
        </div>
      )}
      {repeat !== "none" && (
        <p className="text-xs text-muted-foreground">{t("meetings.repeat.hint")}</p>
      )}
      {repeatError && (
        <p
          id={`${testId}-repeat-error`}
          data-testid={`${testId}-repeat-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {t(repeatError)}
        </p>
      )}
    </fieldset>
  );

  return (
    <form
      noValidate
      data-testid={testId}
      className="min-w-0 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">{t("meetings.form.requiredNote")}</p>
      {mode !== "approve" &&
        !single &&
        (mode === "create" && scopes.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <ScopeSelect
            id={`${testId}-scope`}
            testId={`${testId}-scope`}
            options={
              mode === "create" ? (scopes.data ?? []) : effectiveScope ? [effectiveScope] : []
            }
            value={effectiveScope}
            onChange={(next) => {
              setScope(next);
              setInvitees([]);
            }}
            disabled={busy || mode !== "create"}
          />
        ))}
      {input("title", `${testId}-title`, t("meetings.form.title"), titleValue, setTitle, 200)}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateTimeField
          testIdPrefix={`${testId}-start`}
          legend={t("meetings.form.start")}
          dateLabel={t("meetings.form.startDate")}
          timeLabel={t("meetings.form.startTime")}
          placeholder={t("meetings.form.timePlaceholder")}
          day={startDay}
          time={startTime}
          onChange={setStart}
          required
          disabled={busy}
          errorId={errorId("start")}
          error={fieldError("start")}
        />
        <DateTimeField
          testIdPrefix={`${testId}-end`}
          legend={t("meetings.form.end")}
          dateLabel={t("meetings.form.endDate")}
          timeLabel={t("meetings.form.endTime")}
          placeholder={t("meetings.form.timePlaceholder")}
          day={endDay}
          time={endTime}
          onChange={setEnd}
          required
          disabled={busy}
          errorId={errorId("end")}
          error={fieldError("end")}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("meetings.form.londonTime")}</p>
      <fieldset className="min-w-0 space-y-2" disabled={busy}>
        <legend className="mb-1.5 text-sm font-medium">{t("meetings.form.place")} *</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(["in_person", "online"] as const).map((value) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`${testId}-place`}
                className="size-4"
                data-testid={`${testId}-place-${value === "in_person" ? "in-person" : "online"}`}
                checked={locationType === value}
                onChange={() => setLocationType(value)}
              />
              {value === "in_person" ? t("meetings.place.inPerson") : t("meetings.place.online")}
            </label>
          ))}
        </div>
      </fieldset>
      {locationType === "in_person" ? (
        input(
          "location",
          `${testId}-location`,
          t("meetings.form.location"),
          location,
          setLocation,
          300,
        )
      ) : (
        <div className="min-w-0 space-y-1">
          {input(
            "online_url",
            `${testId}-online-url`,
            t("meetings.form.onlineUrl"),
            onlineUrl,
            setOnlineUrl,
            500,
            "url",
          )}
          <p className="text-xs text-muted-foreground">{t("meetings.form.onlineUrlHint")}</p>
        </div>
      )}
      {showPeople && (
        <Collapsible
          open={inviteesOpen}
          onOpenChange={setInviteesOpen}
          className="min-w-0 rounded-lg border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid={`${testId}-invitees-toggle`}
              data-count={invitees.length}
              aria-expanded={inviteesOpen}
              className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {inviteesHeader(t, t("meetings.invitees"), inviteeNames)}
              </span>
              <ChevronDown
                className={cn("size-4 shrink-0 transition-transform", inviteesOpen && "rotate-180")}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0 border-t p-3">
            <PeopleCombobox
              testId={`${testId}-invitees`}
              label={t("meetings.form.invitees")}
              hideLabel
              people={peopleList}
              selected={invitees}
              onChange={setInvitees}
              disabled={busy || !!createdId}
              loading={people.isLoading}
              emptyText={t("meetings.form.noPeople")}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
      {mode === "create" && !submit && (
        <MeetingCarryOver
          scope={effectiveScope}
          value={carry}
          onChange={setCarry}
          disabled={busy || !!createdId}
          testId={testId}
        />
      )}
      <Collapsible open={more} onOpenChange={setMore} className="min-w-0 rounded-lg border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid={`${testId}-more`}
            data-state={more ? "open" : "closed"}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{t("meetings.form.moreOptions")}</span>
            <ChevronDown
              className={cn("size-4 shrink-0 transition-transform", more && "rotate-180")}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent
          data-testid={`${testId}-more-content`}
          className="min-w-0 space-y-5 border-t p-3"
        >
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${testId}-description`}>{t("meetings.form.description")}</Label>
            <Textarea
              id={`${testId}-description`}
              data-testid={`${testId}-description`}
              value={description}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy || !!createdId}
              rows={3}
            />
          </div>
          {mode === "create" && !submit && (
            <>
              {agendaSection}
              {filesSection}
              {repeatSection}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
      {mode === "create" && !scopes.isLoading && (scopes.data ?? []).length === 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t("meetings.form.noScopes")}
        </p>
      )}
      {fileErrors.length > 0 && (
        <ul
          role="alert"
          data-testid={`${testId}-file-errors`}
          className="space-y-1 text-sm text-destructive"
        >
          {createdId && <li>{t("meetings.form.filesFailed")}</li>}
          {fileErrors.map((message, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              {message}
            </li>
          ))}
        </ul>
      )}
      {(error || people.isError || scopes.isError) && (
        <p
          role="alert"
          data-testid={`${testId}-error`}
          className="text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {error || t("meetings.loadError")}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        {!createdId && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            data-testid={`${testId}-cancel`}
            disabled={busy}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
        )}
        <Button
          type="submit"
          className="h-11"
          data-testid={`${testId}-submit`}
          disabled={busy || (mode === "create" && !effectiveScope)}
        >
          {busy
            ? t("common.saving")
            : createdId
              ? t("meetings.form.continue")
              : mode === "edit"
                ? t("common.save")
                : mode === "approve"
                  ? t("meetings.form.approveSubmit")
                  : t("meetings.form.createSubmit")}
        </Button>
      </div>
      <MeetingScopeDialog
        open={!!pending}
        action="edit"
        busy={busy}
        error={scopeError}
        onClose={() => setPending(null)}
        onConfirm={(choice) => {
          if (pending) void save(pending, choice);
        }}
      />
    </form>
  );
}
