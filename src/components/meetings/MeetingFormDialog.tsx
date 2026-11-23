import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { EventDialog } from "@/components/events/EventDialog";
import { DateTimeField } from "@/components/events/DateTimeField";
import { ScopeSelect } from "@/components/work/ScopeSelect";
import { PersonPicker } from "@/components/work/PersonPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { londonInput, londonToIso } from "@/lib/event-rules";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  validateMeetingForm,
  type MeetingDetail,
  type MeetingFormErrors,
  type MeetingInput,
} from "@/lib/meetings";
import { createMeeting, listMeetingPeople, updateMeeting } from "@/lib/meetings.functions";
import { listMyWorkScopes, scopeKey, type WorkScopeOption } from "@/lib/work-scopes";

type Props = {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit" | "approve";
  meeting?: MeetingDetail;
  initial?: { title?: string; description?: string | null; starts_at?: string; ends_at?: string };
  submit?: (input: MeetingInput) => Promise<string>;
  onSaved?: (meetingId: string) => void;
  testId?: string;
};

/**
 * Create, edit or (from a meeting request) approve a meeting. The database checks scope, invitees and edit rights
 * again; in "approve" mode it uses the request's scope and invites the requester, so both pickers are hidden.
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
    update = useServerFn(updateMeeting);
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

  async function onSubmit() {
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
    if (Object.keys(found).length || !startIso || !endIso) return;
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
    setBusy(true);
    try {
      let id: string;
      if (mode === "edit" && source) {
        await update({ data: { id: source.id, meeting: input } });
        id = source.id;
      } else if (submit) {
        id = await submit(input);
      } else {
        const s = effectiveScope!;
        id = await create({
          data: { ...input, scope: s.scope, branch_id: s.branch_id, region_id: s.region_id },
        });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meetings"] }),
        qc.invalidateQueries({ queryKey: ["meeting"] }),
      ]);
      toast.success(mode === "edit" ? t("meetings.form.updated") : t("meetings.form.created"));
      setBusy(false);
      onSaved?.(id);
      onClose();
    } catch (e) {
      setError(translateError(e));
      setBusy(false);
    }
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
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${testId}-description`}>{t("meetings.form.description")}</Label>
        <Textarea
          id={`${testId}-description`}
          data-testid={`${testId}-description`}
          value={description}
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
        />
      </div>
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
        <PersonPicker
          testId={`${testId}-invitees`}
          legend={t("meetings.form.invitees")}
          people={peopleList}
          selected={invitees}
          onChange={setInvitees}
          disabled={busy}
          loading={people.isLoading}
          emptyText={t("meetings.form.noPeople")}
        />
      )}
      {mode === "create" && !scopes.isLoading && (scopes.data ?? []).length === 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t("meetings.form.noScopes")}
        </p>
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
        <Button
          type="submit"
          className="h-11"
          data-testid={`${testId}-submit`}
          disabled={busy || (mode === "create" && !effectiveScope)}
        >
          {busy
            ? t("common.saving")
            : mode === "edit"
              ? t("common.save")
              : mode === "approve"
                ? t("meetings.form.approveSubmit")
                : t("meetings.form.createSubmit")}
        </Button>
      </div>
    </form>
  );
}
