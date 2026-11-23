import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowUp, ArrowDown, Trash2, FileText, Image, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  EVENT_CATEGORIES,
  EVENT_FILE_ACCEPT,
  eventFileExtension,
  eventFileKind,
  type EventFileKind,
  londonInput,
  londonToIso,
  MAX_EVENT_FILES,
  type HubEvent,
  type EventMedia,
} from "@/lib/event-rules";
import { prepareEventFile, uploadEventFile, removeStoredEventFile } from "@/lib/event-files";
import {
  saveEvent,
  eventBranches,
  reserveEventMedia,
  deleteEventMedia,
  reorderEventMedia,
  createSeries,
  updateSeriesEvent,
} from "@/lib/events.functions";
import {
  buildRule,
  defaultRepeat,
  parseRule,
  type RepeatStart,
  type RepeatState,
  type SeriesInfo,
} from "@/lib/recurrence";
import { validateEventForm } from "@/lib/event-form-rules";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { EventDialog } from "./EventDialog";
import { RepeatFields } from "./RepeatFields";
import { DateField, DateTimeField } from "./DateTimeField";
import type { SeriesMode } from "./RecurringScopeDialog";

type Item = {
  key: string;
  name: string;
  kind: EventFileKind;
  file?: File;
  media?: EventMedia;
  preview?: string;
};
/** With `series` + `seriesMode`, saves an occurrence of a recurring event ('this', 'following' or 'all'). */
export function EventForm({
  event,
  series,
  seriesMode,
  onClose,
  onSaved,
}: {
  event?: HubEvent;
  series?: SeriesInfo | null;
  seriesMode?: SeriesMode;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { session, roles, profile } = useAuth();
  const director = roles.includes("regional_director");
  // National Coordinators create national events only (no branch or region).
  const nc = roles.includes("national_coordinator");
  const qc = useQueryClient();
  const createSeriesFn = useServerFn(createSeries),
    updateSeriesFn = useServerFn(updateSeriesEvent);
  const save = useServerFn(saveEvent),
    branchesFn = useServerFn(eventBranches),
    reserve = useServerFn(reserveEventMedia),
    remove = useServerFn(deleteEventMedia),
    reorder = useServerFn(reorderEventMedia);
  const branches = useQuery({
    queryKey: ["event-branches", session?.user.id],
    queryFn: () => branchesFn(),
  });
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [organizer, setOrganizer] = useState(event?.organizer ?? "Dialogue Society");
  const initialCategory = EVENT_CATEGORIES.find((c) => c === event?.category) ?? "dialogue";
  const [category, setCategory] = useState<typeof initialCategory>(initialCategory);
  const [allDay, setAllDay] = useState(!!event?.all_day);
  // Timed events: a date input plus a quarter-hour time list per side; `start`/`end` are London "YYYY-MM-DDTHH:mm".
  const initialStart = event?.start_at ? londonInput(event.start_at) : "",
    initialEnd = event?.end_at ? londonInput(event.end_at) : "";
  const [startDay, setStartDay] = useState(initialStart.slice(0, 10)),
    [startTime, setStartTime] = useState(initialStart.slice(11, 16));
  const [endDay, setEndDay] = useState(initialEnd.slice(0, 10)),
    [endTime, setEndTime] = useState(initialEnd.slice(11, 16));
  const start = startDay && startTime ? `${startDay}T${startTime}` : "",
    end = endDay && endTime ? `${endDay}T${endTime}` : "";
  const [startDate, setStartDate] = useState(event?.start_date ?? "");
  const [endDate, setEndDate] = useState(
    event?.end_date && event.end_date !== event.start_date ? event.end_date : "",
  );
  const [locationType, setLocationType] = useState<"in_person" | "online">(
    event?.location_type === "online" ? "online" : "in_person",
  );
  const [onlineUrl, setOnlineUrl] = useState(event?.online_url ?? "");
  // End follows Start + 2 hours until the user edits End themselves.
  const endTouched = useRef(!!event?.end_at);
  function setStart(day: string, time: string) {
    setStartDay(day);
    setStartTime(time);
    if (endTouched.current || !day || !time) return;
    try {
      const value = londonInput(
        new Date(Date.parse(londonToIso(`${day}T${time}`)) + 2 * 3600 * 1000),
      );
      setEndDay(value.slice(0, 10));
      setEndTime(value.slice(11, 16));
    } catch {
      /* invalid London time is reported on submit */
    }
  }
  function setEnd(day: string, time: string) {
    endTouched.current = true;
    setEndDay(day);
    setEndTime(time);
  }
  const [capacity, setCapacity] = useState(event?.capacity?.toString() ?? "");
  const [registrationEnabled, setRegistrationEnabled] = useState(
    event?.registration_enabled ?? true,
  );
  const [scope, setScope] = useState<"branch" | "region" | "national">(
    nc || event?.scope === "national"
      ? "national"
      : event?.scope === "region"
        ? "region"
        : "branch",
  );
  // Members only (default) or public: followers and the signed-out website.
  const [audience, setAudience] = useState<"members" | "public">(
    event?.audience === "public" ? "public" : "members",
  );
  const [branch, setBranch] = useState(
    event?.branch_id ?? (director ? "" : (profile?.branch_id ?? "")),
  );
  const [items, setItems] = useState<Item[]>(
    (event?.media ?? []).map((m) => ({
      key: m.id,
      name: m.original_name || (m.storage_path.split("/").pop() ?? m.id),
      kind: m.kind === "pdf" ? "pdf" : m.kind === "document" ? "document" : "image",
      media: m,
    })),
  );
  const attached = useRef<EventMedia[]>(event?.media ?? []);
  const [savedId, setSavedId] = useState(event?.id ?? null);
  // Repeat: new events, or a series edited for 'following' / 'all'. Files of a series live on its media holder.
  const repeatEditable =
    !event || (!!event.series_id && (seriesMode === "following" || seriesMode === "all"));
  const [repeat, setRepeatState] = useState<RepeatState>(() =>
    series && repeatEditable ? parseRule(series.rule) : defaultRepeat(),
  );
  const repeatTouched = useRef(false);
  function setRepeat(next: RepeatState) {
    repeatTouched.current = true;
    setRepeatState(next);
  }
  const mediaTarget = useRef<string | null>(
    event?.series_id ? (series?.media_event_id ?? null) : (event?.id ?? null),
  );
  const repeatStart: RepeatStart = allDay
    ? { date: startDate, allDay: true }
    : { date: startDay, time: startTime, allDay: false };
  const [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  function fieldError(key: string) {
    return fieldErrors[key] ? (
      <p id={`event-form-${key}-error`} role="alert" className="text-sm text-destructive">
        {t(fieldErrors[key])}
      </p>
    ) : null;
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    setPreparing(true);
    setError("");
    setFileErrors([]);
    const next = [...items];
    const rejected: string[] = [];
    for (const original of Array.from(files)) {
      try {
        const file = await prepareEventFile(original, next.length);
        const kind = eventFileKind(eventFileExtension(file.type, file.name)) ?? "document";
        const preview = kind === "image" ? URL.createObjectURL(file) : undefined;
        if (preview) previews.current.push(preview);
        next.push({
          key: crypto.randomUUID(),
          name: original.name,
          kind,
          file,
          ...(preview ? { preview } : {}),
        });
      } catch (e) {
        rejected.push(t("events.fileRejected", { name: original.name, reason: translateError(e) }));
      }
    }
    setFileErrors(rejected);
    // Never leave a PDF as cover when images are available.
    if (next[0] && next[0].kind !== "image") {
      const i = next.findIndex((x) => x.kind === "image");
      if (i > 0) {
        const [cover] = next.splice(i, 1);
        if (cover) next.unshift(cover);
      }
    }
    setItems(next);
    setPreparing(false);
  }
  function move(index: number, delta: number) {
    const next = [...items],
      item = next[index],
      other = next[index + delta];
    if (!item || !other) return;
    next[index] = other;
    next[index + delta] = item;
    if (next[0] && next[0].kind !== "image" && next.some((x) => x.kind === "image")) {
      setError(t("events.orderError"));
      return;
    }
    setItems(next);
    setError("");
  }
  async function submit(status: "draft" | "published" | "cancelled") {
    if (busy) return;
    const timesChanged =
      !event ||
      event.status !== "published" ||
      allDay !== !!event.all_day ||
      (allDay
        ? startDate !== (event.start_date ?? "") ||
          (endDate || startDate) !== (event.end_date ?? event.start_date ?? "")
        : start !== (event.start_at ? londonInput(event.start_at) : "") ||
          end !== (event.end_at ? londonInput(event.end_at) : ""));
    const validation = validateEventForm(
      {
        title,
        allDay,
        start,
        end,
        startDate,
        endDate,
        locationType,
        location,
        onlineUrl,
        category,
        scope,
        branch,
        capacity,
        organizer,
      },
      status,
      { checkPast: timesChanged },
    );
    // A date without a time (or a time without a date) is never saved silently, even as a draft.
    if (!allDay)
      for (const [key, day, time] of [
        ["start", startDay, startTime],
        ["end", endDay, endTime],
      ] as const)
        if (!day !== !time) validation[key] ??= "events.fieldRequired";
    if (repeatEditable && repeat.freq !== "none") {
      // A series always needs its first date, even as a draft.
      if (allDay ? !startDate : !start)
        validation[allDay ? "start-date" : "start"] ??= "events.fieldRequired";
      if (repeat.ends === "on" && (!repeat.until || repeat.until < repeatStart.date))
        validation["repeat-until"] = "events.repeat.untilError";
      if (
        repeat.ends === "after" &&
        !(Number.isInteger(repeat.count) && repeat.count >= 1 && repeat.count <= 1000)
      )
        validation["repeat-count"] = "events.invalid";
    }
    setFieldErrors(validation);
    const first = [
      "title",
      "location-type",
      "location",
      "online-url",
      "organizer",
      "category",
      "start",
      "end",
      "start-date",
      "end-date",
      "repeat-until",
      "repeat-count",
      "scope",
      "branch",
      "capacity",
    ].find((key) => validation[key]);
    if (first) {
      // Timed Start/End errors focus the missing half (date first).
      const target =
        !allDay && (first === "start" || first === "end")
          ? `${first}-${(first === "start" ? startDay : endDay) ? "time" : "date"}`
          : first;
      requestAnimationFrame(() => {
        const node = formRef.current?.querySelector<HTMLElement>(
          `[data-testid="event-form-${target}"]`,
        );
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        node?.focus();
      });
      return;
    }
    if (preparing) {
      setError(t("events.filePreparing"));
      return;
    }
    setBusy(true);
    setError("");
    setFileErrors([]);
    let id = savedId;
    try {
      const startIso = !allDay && start ? londonToIso(start) : null,
        endIso = !allDay && end ? londonToIso(end) : null;
      const data = {
        title,
        description,
        location: locationType === "online" ? location.trim() : location,
        location_type: locationType,
        online_url: locationType === "online" && onlineUrl.trim() ? onlineUrl.trim() : null,
        organizer: organizer.trim() || "Dialogue Society",
        category,
        all_day: allDay,
        start_date: allDay && startDate ? startDate : null,
        end_date: allDay && endDate ? endDate : null,
        start_at: startIso,
        end_at: endIso,
        capacity: capacity ? Number(capacity) : null,
        registration_enabled: registrationEnabled,
        audience,
        scope:
          scope === "national"
            ? ("national" as const)
            : status === "draft" && director && !branch
              ? ("region" as const)
              : scope,
        branch_id: scope === "branch" && branch ? branch : null,
        status,
      };
      const rule = repeatEditable ? buildRule(repeat, repeatStart) : null;
      let createdSeries = false;
      if (!id) {
        if (rule) {
          // A series is created with its final status; its files then go to the series' media holder.
          const created = await createSeriesFn({ data: { event: data, rule } });
          id = created.eventId;
          mediaTarget.current = created.mediaEventId ?? id;
          createdSeries = true;
        } else {
          // Create a recoverable draft before uploading; publish only after all file operations succeed.
          id = await save({ data: { id: null, event: { ...data, status: "draft" } } });
          mediaTarget.current = id;
        }
        setSavedId(id);
      }
      const mediaId = mediaTarget.current ?? id;
      for (const old of [...attached.current]) {
        if (!items.some((x) => x.media?.id === old.id)) {
          await removeStoredEventFile(old.storage_path);
          await remove({ data: { id: old.id } });
          attached.current = attached.current.filter((m) => m.id !== old.id);
        }
      }
      const completed: Item[] = [];
      for (const item of items) {
        if (item.file) {
          const extension = eventFileExtension(item.file.type, item.file.name);
          if (
            extension !== "jpg" &&
            extension !== "png" &&
            extension !== "webp" &&
            extension !== "pdf" &&
            extension !== "docx" &&
            extension !== "pptx"
          )
            throw new Error("Invalid event file");
          let row: EventMedia | undefined;
          try {
            row = {
              ...(await reserve({
                data: {
                  eventId: mediaId,
                  kind: item.kind,
                  extension,
                  originalName: item.name.slice(0, 255),
                },
              })),
              url: null,
            };
            await uploadEventFile(row.storage_path, item.file);
          } catch (e) {
            setFileErrors([
              t("events.fileRejected", { name: item.name, reason: translateError(e) }),
            ]);
            if (row) {
              await removeStoredEventFile(row.storage_path).catch(() => undefined);
              await remove({ data: { id: row.id } });
            }
            throw e;
          }
          const media = { ...row, url: item.preview ?? null };
          attached.current.push(media);
          const updated = {
            key: row.id,
            name: item.name,
            kind: item.kind,
            media,
            ...(item.preview ? { preview: item.preview } : {}),
          };
          completed.push(updated);
          setItems((current) => current.map((x) => (x.key === item.key ? updated : x)));
        } else completed.push(item);
      }
      let ordered = completed;
      if (ordered[0] && ordered[0].kind !== "image") {
        const cover = ordered.find((x) => x.kind === "image");
        if (cover) ordered = [cover, ...ordered.filter((x) => x !== cover)];
      }
      await reorder({
        data: { eventId: mediaId, ids: ordered.flatMap((x) => (x.media ? [x.media.id] : [])) },
      });
      if (createdSeries) {
        /* already saved with its final status */
      } else if (event?.series_id && seriesMode) {
        const updated = await updateSeriesFn({
          data: {
            id,
            mode: seriesMode,
            event: data,
            rule: seriesMode !== "this" && repeatTouched.current ? rule : null,
          },
        });
        id = updated.eventId;
        // Registered occurrences are never regenerated; those the new rule no longer produces stay as exceptions.
        if (updated.keptOffRule.length)
          toast.error(t("registrations.keptOffRule", { count: updated.keptOffRule.length }));
      } else await save({ data: { id, event: data } });
      // Capacity or time changes can promote the waitlist or change registration rules: refresh those too.
      await Promise.all(
        ["events", "event", "registration-summary", "registrations", "my-registrations"].map(
          (key) => qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(t("events.saved"));
      onSaved(id);
    } catch (e) {
      setError(id ? `${t("events.partialError")} ${translateError(e)}` : translateError(e));
    } finally {
      setBusy(false);
    }
  }
  function field(
    label: string,
    testId: string,
    value: string,
    setter: (value: string) => void,
    type = "text",
    required = false,
  ) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={testId}>
          {label}
          {required && " *"}
        </Label>
        <Input
          id={testId}
          data-testid={testId}
          type={type}
          value={value}
          onChange={(e) => setter(e.target.value)}
          aria-required={required}
          aria-invalid={!!fieldErrors[testId.replace("event-form-", "")]}
          aria-describedby={
            fieldErrors[testId.replace("event-form-", "")] ? `${testId}-error` : undefined
          }
          disabled={busy}
          className="min-w-0 h-11"
          {...(type === "number" ? { min: 1, step: 1, placeholder: t("events.unlimited") } : {})}
          {...(testId === "event-form-title" || testId === "event-form-organizer"
            ? { maxLength: 200 }
            : {})}
        />
        {fieldError(testId.replace("event-form-", ""))}
      </div>
    );
  }
  /** Timed Start/End: date input + quarter-hour time list side by side (also at 375px). */
  function dateTime(
    key: "start" | "end",
    day: string,
    time: string,
    setter: (day: string, time: string) => void,
  ) {
    return (
      <DateTimeField
        testIdPrefix={`event-form-${key}`}
        legend={t(`events.${key}`)}
        dateLabel={t(`events.${key}DateLabel`)}
        timeLabel={t(`events.${key}Time`)}
        placeholder={t("events.timePlaceholder")}
        day={day}
        time={time}
        onChange={setter}
        required
        disabled={busy}
        errorId={fieldErrors[key] ? `event-form-${key}-error` : undefined}
        error={fieldError(key)}
      />
    );
  }
  function dateField(
    key: "start-date" | "end-date",
    label: string,
    value: string,
    setter: (value: string) => void,
    required: boolean,
  ) {
    return (
      <DateField
        testId={`event-form-${key}`}
        label={label}
        value={value}
        onChange={setter}
        required={required}
        disabled={busy}
        errorId={fieldErrors[key] ? `event-form-${key}-error` : undefined}
        error={fieldError(key)}
      />
    );
  }
  return (
    <EventDialog
      open
      onClose={() => {
        if (!busy && !preparing) onClose();
      }}
      title={event ? t("events.edit") : t("events.create")}
    >
      <form
        ref={formRef}
        noValidate
        data-testid="event-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(event?.status === "cancelled" ? "cancelled" : "published");
        }}
      >
        <p className="text-sm text-muted-foreground">{t("events.requiredNote")}</p>
        {field(t("events.titleLabel"), "event-form-title", title, setTitle, "text", true)}
        <div className="space-y-1.5">
          <Label htmlFor="event-form-description">{t("events.description")}</Label>
          <Textarea
            id="event-form-description"
            data-testid="event-form-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("events.locationType")} *</Label>
          <Select
            value={locationType}
            disabled={busy}
            onValueChange={(v) => setLocationType(v === "online" ? "online" : "in_person")}
          >
            <SelectTrigger
              data-testid="event-form-location-type"
              aria-label={t("events.locationType")}
              className="h-11"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in_person">{t("events.inPerson")}</SelectItem>
              <SelectItem value="online">{t("events.online")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {locationType === "online" ? (
          <div className="space-y-1">
            {field(
              t("events.onlineUrl"),
              "event-form-online-url",
              onlineUrl,
              setOnlineUrl,
              "url",
              true,
            )}
            <p className="text-xs text-muted-foreground">{t("events.onlineUrlHint")}</p>
          </div>
        ) : (
          field(t("events.location"), "event-form-location", location, setLocation, "text", true)
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {field(t("events.organizer"), "event-form-organizer", organizer, setOrganizer, "text")}
          <div className="space-y-1.5">
            <Label>{t("events.category")} *</Label>
            <Select
              value={category}
              disabled={busy}
              onValueChange={(v) => {
                const c = EVENT_CATEGORIES.find((x) => x === v);
                if (c) setCategory(c);
              }}
            >
              <SelectTrigger
                data-testid="event-form-category"
                aria-label={t("events.category")}
                className="h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`events.categories.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError("category")}
          </div>
          <div className="flex min-h-11 items-center gap-3 sm:col-span-2">
            <Switch
              id="event-form-all-day"
              data-testid="event-form-all-day"
              checked={allDay}
              disabled={busy}
              onCheckedChange={setAllDay}
            />
            <Label htmlFor="event-form-all-day">{t("events.allDay")}</Label>
          </div>
          {allDay ? (
            <>
              {dateField("start-date", t("events.startDate"), startDate, setStartDate, true)}
              {dateField("end-date", t("events.endDate"), endDate, setEndDate, false)}
            </>
          ) : (
            <>
              {dateTime("start", startDay, startTime, setStart)}
              {dateTime("end", endDay, endTime, setEnd)}
            </>
          )}
          {repeatEditable && (
            <div className="sm:col-span-2">
              <RepeatFields
                value={repeat}
                onChange={setRepeat}
                start={repeatStart}
                disabled={busy}
                errors={fieldErrors}
              />
            </div>
          )}
          {director && (
            <div className="space-y-1.5">
              <Label>{t("events.scope")} *</Label>
              <Select
                value={scope}
                disabled={busy}
                onValueChange={(v) => setScope(v === "region" ? "region" : "branch")}
              >
                <SelectTrigger
                  data-testid="event-form-scope"
                  aria-label={t("events.scope")}
                  className="h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">{t("events.branch")}</SelectItem>
                  <SelectItem value="region">{t("events.region")}</SelectItem>
                </SelectContent>
              </Select>
              {fieldError("scope")}
            </div>
          )}
          {director && scope === "branch" && (
            <div className="space-y-1.5">
              <Label>{t("events.branch")} *</Label>
              <Select
                value={branch}
                onValueChange={setBranch}
                disabled={busy || branches.isLoading}
              >
                <SelectTrigger
                  data-testid="event-form-branch"
                  aria-label={t("events.branch")}
                  className="h-11"
                >
                  <SelectValue placeholder={t("auth.chooseBranch")} />
                </SelectTrigger>
                <SelectContent>
                  {(branches.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError("branch")}
            </div>
          )}
          {nc && (
            <div className="space-y-1.5">
              <Label>{t("events.scope")}</Label>
              <p
                data-testid="event-form-scope-national"
                className="flex min-h-11 items-center text-sm"
              >
                {t("events.national")}
              </p>
            </div>
          )}
          {!director && !nc && (
            <div className="space-y-1.5">
              <Label htmlFor="event-form-branch">{t("events.branch")} *</Label>
              <Input
                id="event-form-branch"
                data-testid="event-form-branch"
                readOnly
                aria-readonly
                value={
                  (branches.data ?? []).find((b) => b.id === branch)?.name ??
                  profile?.branches?.name ??
                  ""
                }
                className="h-11 bg-muted"
              />
              <p className="text-xs text-muted-foreground">{t("events.branchFixed")}</p>
              {fieldError("branch")}
            </div>
          )}
          {scope === "region" && (
            <div className="space-y-1.5">
              <Label>{t("events.region")} *</Label>
              <p className="text-sm">{profile?.branches?.regions?.name ?? t("events.region")}</p>
            </div>
          )}
          <div className="space-y-1">
            {field(t("events.capacity"), "event-form-capacity", capacity, setCapacity, "number")}
            <p className="text-xs text-muted-foreground">{t("registrations.capacityHint")}</p>
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id="event-form-registration-enabled"
              data-testid="event-form-registration-enabled"
              checked={registrationEnabled}
              disabled={busy}
              onCheckedChange={setRegistrationEnabled}
            />
            <Label htmlFor="event-form-registration-enabled">{t("registrations.open")}</Label>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("events.visibleTo")}</Label>
            <Select
              value={audience}
              disabled={busy}
              onValueChange={(v) => setAudience(v === "public" ? "public" : "members")}
            >
              <SelectTrigger
                data-testid="event-form-audience"
                aria-label={t("events.visibleTo")}
                className="h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="members" data-testid="event-form-audience-option-members">
                  {t("events.audience.members")}
                </SelectItem>
                <SelectItem value="public" data-testid="event-form-audience-option-public">
                  {t("events.audience.public")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("events.audienceHint")}</p>
          </div>
        </div>
        {branches.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("errors.branchesLoad")}
          </p>
        )}
        <section className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">{t("events.files")}</h3>
          <p className="text-xs text-muted-foreground">{t("events.fileLimits")}</p>
          <Label
            htmlFor="event-form-file-input"
            className="flex min-h-11 items-center gap-2 text-primary"
          >
            <Upload className="size-4" />
            {t("events.files")}
          </Label>
          <Input
            id="event-form-file-input"
            data-testid="event-form-file-input"
            type="file"
            accept={EVENT_FILE_ACCEPT}
            multiple
            disabled={busy || preparing || items.length >= MAX_EVENT_FILES}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {preparing && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("events.filePreparing")}
            </p>
          )}
          <ol className="space-y-2">
            {items.map((item, i) => (
              <li
                key={item.key}
                data-testid="event-form-file-item"
                data-position={i}
                className="flex min-w-0 flex-wrap items-center gap-2 border-b py-2"
              >
                {(item.preview ?? item.media?.url) && item.kind === "image" ? (
                  <img
                    src={item.preview ?? item.media?.url ?? ""}
                    alt=""
                    className="size-12 rounded-md object-cover"
                  />
                ) : item.kind !== "image" ? (
                  <FileText className="size-6 text-muted-foreground" />
                ) : (
                  <Image className="size-6 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 break-all text-xs">
                  {item.name}
                  {i === 0 && item.kind === "image" && (
                    <span className="ml-2 font-semibold text-primary">{t("events.cover")}</span>
                  )}
                </span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy || preparing || i === 0}
                    aria-label={t("events.moveUp")}
                    title={t("events.moveUp")}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy || preparing || i === items.length - 1}
                    aria-label={t("events.moveDown")}
                    title={t("events.moveDown")}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    data-testid="event-form-file-remove"
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy || preparing}
                    aria-label={t("events.remove")}
                    title={t("events.remove")}
                    onClick={() => setItems(items.filter((_, index) => index !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {fileErrors.length > 0 && (
          <ul
            data-testid="event-form-file-errors"
            role="alert"
            className="space-y-1 text-sm text-destructive"
          >
            {fileErrors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        )}
        {error && (
          <p data-testid="event-form-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {savedId && error && (
          <Button asChild variant="link">
            <Link to="/events/$id" params={{ id: savedId }}>
              {t("events.openSaved")}
            </Link>
          </Button>
        )}
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          {event?.status !== "cancelled" && (
            <Button
              data-testid="event-form-save-draft"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void submit("draft")}
            >
              {busy ? t("common.saving") : t("events.saveDraft")}
            </Button>
          )}
          <Button data-testid="event-form-publish" type="submit" disabled={busy}>
            {busy
              ? t("common.saving")
              : event?.status === "cancelled"
                ? t("common.save")
                : t("events.publish")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}
