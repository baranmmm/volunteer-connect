import { useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUp, ArrowDown, Trash2, FileText, Image, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  CALENDAR_CATEGORIES,
  EVENT_CATEGORIES,
  EVENT_FILE_ACCEPT,
  isMeetingEvent,
  eventFileExtension,
  eventFileKind,
  type EventFileKind,
  londonInput,
  londonToIso,
  MAX_EVENT_FILES,
  type HubEvent,
  type EventMedia,
} from "@/lib/event-rules";
import {
  prepareEventFile,
  preparedImageSize,
  uploadEventFile,
  uploadImageVariants,
  removeStoredEventFile,
} from "@/lib/event-files";
import {
  saveEvent,
  eventBranches,
  reserveEventMedia,
  deleteEventMedia,
  reorderEventMedia,
  createSeries,
  updateSeriesEvent,
  setEventMediaSize,
  setEventMediaVariants,
  setEventMediaGallery,
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
import { validateMeetingForm } from "@/lib/meetings";
import { createMeeting, listMeetingPeople } from "@/lib/meetings.functions";
import { listMyWorkScopes } from "@/lib/work-scopes";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { normalisePostcode } from "@/lib/branch-map";
import { saveEventPostcode } from "@/lib/event-location.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FormSection } from "./FormSection";
import { MeetingRepeatFields } from "./MeetingRepeatFields";
import {
  defaultMeetingRepeat,
  meetingRecurrenceOf,
  meetingRepeatError,
  type MeetingRepeatState,
} from "@/lib/event-meeting-repeat";
import { PeopleCombobox } from "@/components/work/PeopleCombobox";

/** Collapsible sections of the form (all collapsed when the form opens). */
const SECTIONS = [
  "description",
  "location",
  "registration",
  "audience",
  "files",
  "repeat",
] as const;
type Section = (typeof SECTIONS)[number];

type Item = {
  key: string;
  name: string;
  kind: EventFileKind;
  file?: File;
  media?: EventMedia;
  preview?: string;
  /** "Show in public gallery" (images of public, non-recurring events). */
  inGallery?: boolean;
};
/**
 * Create or edit an event. Title, category, date/time and place are always visible; the rest sits in collapsed sections
 * that open on a validation error. With `series` + `seriesMode`, saves an occurrence of a recurring event ('this',
 * 'following' or 'all'). Creating with the category "Meeting" turns it into a meeting form (invitees, meeting repeat)
 * that saves through createMeeting and opens the meeting page.
 */
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
    reorder = useServerFn(reorderEventMedia),
    setSize = useServerFn(setEventMediaSize),
    setVariants = useServerFn(setEventMediaVariants),
    setGallery = useServerFn(setEventMediaGallery);
  const branches = useQuery({
    queryKey: ["event-branches", session?.user.id],
    queryFn: () => branchesFn(),
  });
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [organizer, setOrganizer] = useState(event?.organizer ?? "Dialogue Society");
  // A meeting's calendar entry is edited through its meeting; an event never becomes a meeting (or back).
  const editingMeeting = !!event && isMeetingEvent(event);
  const categories = event
    ? editingMeeting
      ? CALENDAR_CATEGORIES
      : EVENT_CATEGORIES
    : CALENDAR_CATEGORIES;
  const initialCategory = CALENDAR_CATEGORIES.find((c) => c === event?.category) ?? "dialogue";
  const [category, setCategory] = useState<(typeof CALENDAR_CATEGORIES)[number]>(initialCategory);
  const meetingMode = !event && isMeetingEvent({ category });
  const navigate = useNavigate();
  const createMeetingFn = useServerFn(createMeeting),
    scopesFn = useServerFn(listMyWorkScopes),
    peopleFn = useServerFn(listMeetingPeople);
  const [open, setOpen] = useState<Partial<Record<Section, boolean>>>({});
  const toggle = (name: Section) => setOpen((current) => ({ ...current, [name]: !current[name] }));
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
  // "To be announced" (in-person, single events): the place is cleared and published later (update emails).
  const [locationTba, setLocationTba] = useState(!!event?.location_tba);
  const [maxPlaces, setMaxPlaces] = useState(String(event?.max_places ?? 1));
  // Optional venue postcode for the public map (in-person single events); without one the branch location is used.
  const [postcode, setPostcode] = useState(event?.postcode ?? "");
  const savePostcode = useServerFn(saveEventPostcode);
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
      inGallery: !!m.in_gallery,
    })),
  );
  const attached = useRef<EventMedia[]>(event?.media ?? []);
  const [savedId, setSavedId] = useState(event?.id ?? null);
  // Meeting mode: invitees from the meeting's scope, and the meeting repeat.
  const [invitees, setInvitees] = useState<string[]>([]);
  const [meetingRepeat, setMeetingRepeat] = useState<MeetingRepeatState>(defaultMeetingRepeat);
  const workScopes = useQuery({
    queryKey: ["work-scopes", session?.user.id],
    queryFn: () => scopesFn(),
    enabled: meetingMode && !!session,
    staleTime: 60000,
  });
  const regionId = (workScopes.data ?? []).find((s) => s.scope === "region")?.region_id ?? null;
  const meetingScope =
    scope === "national"
      ? { scope: "national" as const, branch_id: null, region_id: null }
      : scope === "region"
        ? { scope: "region" as const, branch_id: null, region_id: regionId }
        : { scope: "branch" as const, branch_id: branch || null, region_id: null };
  const meetingScopeReady =
    meetingScope.scope === "national" ||
    (meetingScope.scope === "region" ? !!meetingScope.region_id : !!meetingScope.branch_id);
  const people = useQuery({
    queryKey: [
      "meeting-people",
      session?.user.id,
      meetingScope.scope,
      meetingScope.branch_id,
      meetingScope.region_id,
    ],
    queryFn: () =>
      peopleFn({
        data: {
          scope: meetingScope.scope,
          branchId: meetingScope.branch_id,
          regionId: meetingScope.region_id,
        },
      }),
    enabled: meetingMode && meetingScopeReady && !!session,
    staleTime: 60000,
  });
  // Repeat: new events, or a series edited for 'following' / 'all'. Files of a series live on its media holder.
  const repeatEditable =
    !event || (!!event.series_id && (seriesMode === "following" || seriesMode === "all"));
  const [repeat, setRepeatState] = useState<RepeatState>(() =>
    series && repeatEditable ? parseRule(series.rule) : defaultRepeat(),
  );
  const repeatTouched = useRef(false);
  // "To be announced", places per registration and the gallery tick apply to single events only.
  const singleEvent = !event?.series_id && !(repeatEditable && repeat.freq !== "none");
  const hasImage = items.some((x) => x.kind === "image");
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
  /** Shows the errors: opens every section holding one, then focuses the first invalid field. */
  function showErrors(validation: Record<string, string>) {
    setFieldErrors(validation);
    const sectionOf: Record<string, Section> = {
      organizer: "description",
      capacity: "registration",
      "max-places": "registration",
      files: "files",
      "repeat-until": "repeat",
      "repeat-count": "repeat",
      "meeting-repeat-count": "repeat",
      postcode: "location",
      ...(director ? {} : { branch: "audience" as const, scope: "audience" as const }),
    };
    const opened = Object.keys(validation).flatMap((key) => {
      const section = sectionOf[key];
      return section ? [section] : [];
    });
    if (opened.length)
      setOpen((current) => ({ ...current, ...Object.fromEntries(opened.map((x) => [x, true])) }));
    const first = [
      "title",
      "category",
      "start",
      "end",
      "start-date",
      "end-date",
      "location-type",
      "location",
      "online-url",
      "postcode",
      "scope",
      "branch",
      "organizer",
      "capacity",
      "max-places",
      "files",
      "repeat-until",
      "repeat-count",
      "meeting-repeat-count",
    ].find((key) => validation[key]);
    if (!first) return false;
    // Timed Start/End errors focus the missing half (date first).
    const target =
      !allDay && (first === "start" || first === "end")
        ? `${first}-${(first === "start" ? startDay : endDay) ? "time" : "date"}`
        : first === "files"
          ? "file-input"
          : first;
    // Two frames: a section opened above renders before the field is focused.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const node = formRef.current?.querySelector<HTMLElement>(
          `[data-testid="event-form-${target}"]`,
        );
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        node?.focus();
      }),
    );
    return true;
  }
  /** Meeting mode: one meeting (or a recurring series) with its calendar entry, then the meeting page. */
  async function submitMeeting() {
    if (busy) return;
    const iso = (value: string) => {
      if (!value) return null;
      try {
        return londonToIso(value);
      } catch {
        return undefined;
      }
    };
    const startIso = iso(start),
      endIso = iso(end);
    const found = validateMeetingForm({
      title,
      start: startIso ? new Date(startIso) : null,
      end: endIso ? new Date(endIso) : null,
      location_type: locationType,
      location,
      online_url: onlineUrl,
    });
    const validation: Record<string, string> = {};
    if (found.title) validation["title"] = found.title;
    if (found.start || startIso === undefined)
      validation["start"] = found.start ?? "meetings.errors.start";
    if (found.end || endIso === undefined) validation["end"] = found.end ?? "meetings.errors.end";
    if (found.location) validation["location"] = found.location;
    if (found.online_url) validation["online-url"] = found.online_url;
    if (!meetingScopeReady)
      validation[director && scope === "branch" ? "branch" : "scope"] = "events.fieldRequired";
    const repeatError = meetingRepeatError(meetingRepeat);
    if (repeatError) validation["meeting-repeat-count"] = repeatError;
    if (showErrors(validation) || !startIso || !endIso) return;
    setBusy(true);
    setError("");
    try {
      const id = await createMeetingFn({
        data: {
          ...meetingScope,
          title: title.trim(),
          description: description.trim() || null,
          starts_at: startIso,
          ends_at: endIso,
          location_type: locationType,
          location: locationType === "in_person" ? location.trim() : null,
          online_url: locationType === "online" ? onlineUrl.trim() : null,
          invitee_ids: invitees,
          recurrence: meetingRecurrenceOf(meetingRepeat),
        },
      });
      await Promise.all(
        ["events", "meetings", "meeting"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(t("meetings.form.created"));
      onClose();
      void navigate({ to: "/meetings/$id", params: { id } });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(status: "draft" | "published" | "cancelled") {
    if (busy) return;
    if (meetingMode) return submitMeeting();
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
        locationTba: singleEvent && locationType === "in_person" && locationTba,
        audience,
        hasImage,
        ...(singleEvent && registrationEnabled ? { maxPlaces } : {}),
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
    const withPostcode = singleEvent && locationType === "in_person";
    const normalisedPostcode = withPostcode ? normalisePostcode(postcode) : "";
    if (normalisedPostcode === null) validation["postcode"] = "errors.postcodeInvalid";
    if (showErrors(validation)) return;
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
      const tba = singleEvent && locationType === "in_person" && locationTba;
      const data = {
        title,
        description,
        location: tba ? "" : locationType === "online" ? location.trim() : location,
        location_type: locationType,
        online_url: locationType === "online" && onlineUrl.trim() ? onlineUrl.trim() : null,
        organizer: organizer.trim() || "Dialogue Society",
        category: EVENT_CATEGORIES.find((c) => c === category) ?? "other",
        all_day: allDay,
        start_date: allDay && startDate ? startDate : null,
        end_date: allDay && endDate ? endDate : null,
        start_at: startIso,
        end_at: endIso,
        capacity: capacity ? Number(capacity) : null,
        registration_enabled: registrationEnabled,
        location_tba: tba,
        max_places: singleEvent && registrationEnabled ? Number(maxPlaces) : 1,
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
          // A series is created with its final status, except a public one, which needs its cover first: it starts
          // as a draft, its files go to the series' media holder, then the whole series is published.
          const created = await createSeriesFn({
            data: {
              event:
                audience === "public" && status === "published"
                  ? { ...data, status: "draft" }
                  : data,
              rule,
            },
          });
          id = created.eventId;
          mediaTarget.current = created.mediaEventId ?? id;
          createdSeries = !(audience === "public" && status === "published");
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
            const size = item.kind === "image" ? preparedImageSize(item.file) : null;
            if (size) await setSize({ data: { id: row.id, ...size } });
            // Resized copies for the public pages; a failure keeps the original (never fatal).
            if (item.kind === "image") {
              const rowId = row.id;
              await uploadImageVariants(row.storage_path, item.file, () =>
                setVariants({ data: { id: rowId } }),
              );
            }
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
            ...(item.inGallery !== undefined ? { inGallery: item.inGallery } : {}),
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
      } else if (!event && rule) {
        // A new public series: publish every occurrence now that the cover is uploaded.
        const updated = await updateSeriesFn({
          data: { id, mode: "all", event: data, rule: null },
        });
        id = updated.eventId;
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
      // Gallery ticks once the event is saved as public (the database allows them for public events only).
      if (singleEvent && audience === "public")
        for (const item of ordered)
          if (item.kind === "image" && item.media && !!item.inGallery !== !!item.media.in_gallery) {
            await setGallery({ data: { id: item.media.id, inGallery: !!item.inGallery } });
            item.media.in_gallery = !!item.inGallery;
          }
      // The map postcode: saved (and geocoded on the server) only when it changed; an online event drops it.
      const wantedPostcode = normalisedPostcode ?? "";
      if (wantedPostcode !== (event?.postcode ?? "") && (withPostcode || event?.postcode)) {
        const placed = await savePostcode({ data: { eventId: id, postcode: wantedPostcode } });
        if (!placed.located) toast.error(t("events.mapLocation.postcodeNotLocated"));
      }
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
  const section = (name: Section, children: ReactNode) => (
    <FormSection
      name={name}
      title={t(`events.sections.${name}`)}
      open={!!open[name]}
      onToggle={() => toggle(name)}
    >
      {children}
    </FormSection>
  );
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
        data-mode={meetingMode ? "meeting" : "event"}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(event?.status === "cancelled" ? "cancelled" : "published");
        }}
      >
        <p className="text-sm text-muted-foreground">{t("events.requiredNote")}</p>
        {field(t("events.titleLabel"), "event-form-title", title, setTitle, "text", true)}
        <div className="space-y-1.5">
          <Label>{t("events.category")} *</Label>
          <Select
            value={category}
            disabled={busy || editingMeeting}
            onValueChange={(v) => {
              const c = categories.find((x) => x === v);
              if (!c) return;
              setCategory(c);
              // Meetings are always timed.
              if (!event && isMeetingEvent({ category: c })) setAllDay(false);
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
              {categories.map((c) => (
                <SelectItem key={c} value={c} data-testid={`event-form-category-option-${c}`}>
                  {t(`events.categories.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError("category")}
          {meetingMode && (
            <p data-testid="event-form-meeting-hint" className="text-xs text-muted-foreground">
              {t("events.meetingForm.hint")}
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {!meetingMode && (
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
          )}
          {allDay && !meetingMode ? (
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
        {/* The online link is required when online, so it sits with the place, never in a collapsed section. */}
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
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="event-form-location">
                {t("events.location")}
                {!(singleEvent && locationTba) && " *"}
              </Label>
              <Input
                id="event-form-location"
                data-testid="event-form-location"
                value={singleEvent && locationTba ? "" : location}
                onChange={(e) => setLocation(e.target.value)}
                aria-required={!(singleEvent && locationTba)}
                aria-invalid={!!fieldErrors["location"]}
                aria-describedby={fieldErrors["location"] ? "event-form-location-error" : undefined}
                disabled={busy || (singleEvent && locationTba)}
                placeholder={singleEvent && locationTba ? t("events.locationTba") : undefined}
                className="h-11 min-w-0"
              />
              {fieldError("location")}
            </div>
            {singleEvent && !meetingMode && (
              <div className="flex min-h-11 items-center gap-3">
                <Checkbox
                  id="event-form-location-tba"
                  data-testid="event-form-location-tba"
                  checked={locationTba}
                  disabled={busy}
                  onCheckedChange={(v) => {
                    setLocationTba(v === true);
                    if (v === true) setLocation("");
                  }}
                />
                <Label htmlFor="event-form-location-tba">{t("events.locationTbaOption")}</Label>
              </div>
            )}
          </div>
        )}
        {director && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("events.scope")} *</Label>
              <Select
                value={scope}
                disabled={busy}
                onValueChange={(v) => {
                  setScope(v === "region" ? "region" : "branch");
                  setInvitees([]);
                }}
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
            {scope === "branch" ? (
              <div className="space-y-1.5">
                <Label>{t("events.branch")} *</Label>
                <Select
                  value={branch}
                  onValueChange={(v) => {
                    setBranch(v);
                    setInvitees([]);
                  }}
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
            ) : (
              <div className="space-y-1.5">
                <Label>{t("events.region")} *</Label>
                <p className="flex min-h-11 items-center text-sm">
                  {profile?.branches?.regions?.name ?? t("events.region")}
                </p>
              </div>
            )}
          </div>
        )}
        {branches.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("errors.branchesLoad")}
          </p>
        )}
        {meetingMode && (
          <PeopleCombobox
            testId="event-form-invitees"
            label={t("events.meetingForm.invitees")}
            people={people.data ?? []}
            selected={invitees}
            onChange={setInvitees}
            disabled={busy}
            loading={people.isLoading}
            emptyText={
              meetingScopeReady ? t("events.meetingForm.noPeople") : t("events.meetingForm.noScope")
            }
          />
        )}
        <div className="space-y-0">
          {section(
            "description",
            <>
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
              {!meetingMode &&
                field(
                  t("events.organizer"),
                  "event-form-organizer",
                  organizer,
                  setOrganizer,
                  "text",
                )}
            </>,
          )}
          {!meetingMode &&
            singleEvent &&
            locationType === "in_person" &&
            section(
              "location",
              <div className="space-y-1">
                {field(
                  t("events.mapLocation.postcode"),
                  "event-form-postcode",
                  postcode,
                  setPostcode,
                )}
                <p className="text-xs text-muted-foreground">
                  {t("events.mapLocation.postcodeHelp")}
                </p>
              </div>,
            )}
          {!meetingMode &&
            section(
              "registration",
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  {field(
                    t("events.capacity"),
                    "event-form-capacity",
                    capacity,
                    setCapacity,
                    "number",
                  )}
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
                {singleEvent && registrationEnabled && (
                  <div className="space-y-1">
                    <Label htmlFor="event-form-max-places">{t("events.maxPlaces")}</Label>
                    <Input
                      id="event-form-max-places"
                      data-testid="event-form-max-places"
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={maxPlaces}
                      onChange={(e) => setMaxPlaces(e.target.value)}
                      aria-invalid={!!fieldErrors["max-places"]}
                      aria-describedby={
                        fieldErrors["max-places"] ? "event-form-max-places-error" : undefined
                      }
                      disabled={busy}
                      className="h-11 min-w-0"
                    />
                    <p className="text-xs text-muted-foreground">{t("events.maxPlacesHint")}</p>
                    {fieldError("max-places")}
                  </div>
                )}
              </div>,
            )}
          {!meetingMode &&
            section(
              "audience",
              <>
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
                <div className="space-y-1.5">
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
              </>,
            )}
          {!meetingMode &&
            section(
              "files",
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{t("events.fileLimits")}</p>
                {audience === "public" && (
                  <p className="text-xs text-muted-foreground">{t("events.coverHint")}</p>
                )}
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
                {fieldError("files")}
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
                          <span className="ml-2 font-semibold text-primary">
                            {t("events.cover")}
                          </span>
                        )}
                      </span>
                      {singleEvent && audience === "public" && item.kind === "image" && (
                        <div className="flex min-h-11 items-center gap-2">
                          <Checkbox
                            id={`event-form-file-gallery-${item.key}`}
                            data-testid="event-form-file-gallery"
                            checked={!!item.inGallery}
                            disabled={busy || preparing}
                            onCheckedChange={(v) =>
                              setItems((current) =>
                                current.map((x) =>
                                  x.key === item.key ? { ...x, inGallery: v === true } : x,
                                ),
                              )
                            }
                          />
                          <Label
                            htmlFor={`event-form-file-gallery-${item.key}`}
                            className="text-xs"
                          >
                            {t("events.showInGallery")}
                          </Label>
                        </div>
                      )}
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
              </div>,
            )}
          {meetingMode
            ? section(
                "repeat",
                <MeetingRepeatFields
                  value={meetingRepeat}
                  onChange={setMeetingRepeat}
                  disabled={busy}
                  error={fieldErrors["meeting-repeat-count"]}
                />,
              )
            : repeatEditable &&
              section(
                "repeat",
                <RepeatFields
                  value={repeat}
                  onChange={setRepeat}
                  start={repeatStart}
                  disabled={busy}
                  errors={fieldErrors}
                />,
              )}
        </div>
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
          {event?.status !== "cancelled" && !meetingMode && (
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
              : meetingMode
                ? t("events.meetingForm.submit")
                : event?.status === "cancelled"
                  ? t("common.save")
                  : t("events.publish")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}
