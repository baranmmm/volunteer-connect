// Event test data. Events are created and cancelled as the (fresh) user through the app's own RPCs, so
// RLS, validate_event and created_by behave exactly as in the app. Only cleanup uses the service role.
import { adminClient, clientAs } from "./SupabaseClient";
import { TINY_PNG } from "./eventRequests";

/** A valid 1x1 PNG for test uploads (the cover a published public event needs). */
export { TINY_PNG };

/** Every test event title starts with this, so teardown can find leftovers. */
export const EVENT_TITLE_PREFIX = "E2E Event ";

export type EventStatus = "draft" | "published";
export type EventSpec = {
  title: string;
  branchId: string;
  status: EventStatus;
  /** Timed event: start relative to now. Omit both for an unscheduled draft. */
  startInMinutes?: number;
  /** Timed event at an exact London wall-clock start, "YYYY-MM-DDTHH:mm" (instead of startInMinutes). */
  startLocal?: string;
  durationMinutes?: number;
  /** NULL / omitted = unlimited. */
  capacity?: number | null;
  registrationEnabled?: boolean;
  /** members (default) or public: followers and the signed-out website. */
  audience?: "public" | "members";
  /** An online event with this https link (the link must never reach anonymous visitors). */
  onlineUrl?: string;
  /** In-person place "To be announced" (no location yet). */
  locationTba?: boolean;
  /** Places one registration may book (1-10, default 1). */
  maxPlaces?: number;
};

function payload(spec: EventSpec) {
  const start = spec.startLocal ? new Date(londonIso(spec.startLocal)) : spec.startInMinutes !== undefined ? new Date(Date.now() + spec.startInMinutes * 60_000) : null;
  const end = start ? new Date(start.getTime() + (spec.durationMinutes ?? 60) * 60_000) : null;
  return {
    title: spec.title,
    description: "",
    location: spec.locationTba ? "" : "E2E Community Hall",
    location_tba: !!spec.locationTba,
    max_places: spec.maxPlaces ?? 1,
    location_type: spec.onlineUrl ? "online" : "in_person",
    online_url: spec.onlineUrl ?? null,
    organizer: "E2E",
    category: "dialogue",
    all_day: false,
    start_date: null,
    end_date: null,
    start_at: start?.toISOString() ?? null,
    end_at: end?.toISOString() ?? null,
    capacity: spec.capacity ?? null,
    registration_enabled: spec.registrationEnabled ?? true,
    audience: spec.audience ?? "members",
    scope: "branch",
    branch_id: spec.branchId,
    status: spec.status,
  };
}

/** create_event as `email` (a branch manager or regional director); returns the new event id. */
/** The create/update_event payload for a spec (start/end from startLocal or startInMinutes). */
export function eventPayload(spec: EventSpec) {
  return payload(spec);
}

/** Reserves an image slot on `eventId` as `email` and uploads a tiny PNG there (the app's own reserve → upload flow). */
export async function addCoverImageAs(email: string, eventId: string): Promise<{ mediaId: string; path: string }> {
  const db = await clientAs(email);
  const { data: mediaId, error } = await db.rpc("add_event_media", { _event: eventId, _kind: "image", _extension: "png", _original_name: "cover.png" });
  if (error || !mediaId) throw new Error(`add_event_media ${eventId}: ${error?.message ?? "no id"}`);
  const path = `${eventId}/${String(mediaId)}.png`;
  const up = await db.storage.from("event-media").upload(path, TINY_PNG, { contentType: "image/png" });
  if (up.error) throw new Error(`upload cover ${path}: ${up.error.message}`);
  return { mediaId: String(mediaId), path };
}

/**
 * create_event as `email`. A published public event needs a cover image, so it is created as a draft, given a tiny
 * image and then published with update_event, exactly like the app's form does.
 */
export async function createEventAs(email: string, spec: EventSpec): Promise<string> {
  const db = await clientAs(email);
  const needsCover = spec.status === "published" && spec.audience === "public";
  const data = payload(needsCover ? { ...spec, status: "draft" } : spec);
  const { data: id, error } = await db.rpc("create_event", { _data: data });
  if (error || !id) throw new Error(`create_event "${spec.title}": ${error?.message ?? "no id"}`);
  if (needsCover) {
    await addCoverImageAs(email, String(id));
    const up = await db.rpc("update_event", { _event: String(id), _data: { ...data, status: "published" } });
    if (up.error) throw new Error(`publish "${spec.title}": ${up.error.message}`);
  }
  return String(id);
}

/** A national event, created directly with the service role (owner: a National Coordinator). Remove with deleteEvents. */
export async function createNationalEventAdmin(ownerId: string, spec: Omit<EventSpec, "branchId">): Promise<string> {
  const data = { ...payload({ ...spec, branchId: "" }), scope: "national", branch_id: null, region_id: null, created_by: ownerId };
  const { data: row, error } = await adminClient().from("events").insert(data).select("id").single();
  if (error || !row) throw new Error(`national event "${spec.title}": ${error?.message}`);
  return (row as { id: string }).id;
}

export async function cancelEventAs(email: string, id: string): Promise<void> {
  const { error } = await (await clientAs(email)).rpc("cancel_event", { _event: id });
  if (error) throw new Error(`cancel_event ${id}: ${error.message}`);
}

export type SeriesSpec = {
  title: string;
  branchId: string;
  /** First occurrence, London wall clock "YYYY-MM-DDTHH:mm". */
  startLocal: string;
  durationMinutes?: number;
  rule: string;
  status?: EventStatus;
};
/** London wall clock -> ISO instant (handles GMT/BST). */
export function londonIso(local: string): string {
  const guess = new Date(`${local}:00Z`);
  const offset = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(d);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return tz === "GMT" ? 0 : Number(tz.replace("GMT", "")) * 60;
  };
  return new Date(guess.getTime() - offset(guess) * 60_000).toISOString();
}
/** create_series as `email`; returns the series id, first occurrence id and the media holder id. */
export async function createSeriesAs(email: string, spec: SeriesSpec) {
  const start = londonIso(spec.startLocal);
  const end = new Date(Date.parse(start) + (spec.durationMinutes ?? 90) * 60_000).toISOString();
  const data = { ...payload({ title: spec.title, branchId: spec.branchId, status: spec.status ?? "published" }), start_at: start, end_at: end };
  const { data: res, error } = await (await clientAs(email)).rpc("create_series", { _data: data, _rule: spec.rule });
  if (error || !res) throw new Error(`create_series "${spec.title}": ${error?.message ?? "no result"}`);
  const r = res as { series_id: string; event_id: string; media_event_id: string; count: number };
  return { seriesId: r.series_id, firstEventId: r.event_id, mediaEventId: r.media_event_id, count: r.count };
}
export type Occurrence = { id: string; title: string; londonStart: string; utcStart: string; exception: boolean; seriesId: string | null };
/** Live occurrences of the series that share a media holder (a split series keeps the holder), by start. */
export async function occurrencesOf(mediaEventId: string): Promise<Occurrence[]> {
  const series = await adminClient().from("event_series").select("id").eq("media_event_id", mediaEventId);
  if (series.error) throw new Error(`read series: ${series.error.message}`);
  const ids = series.data.map((s: { id: string }) => s.id);
  if (!ids.length) return [];
  const { data, error } = await adminClient().from("events").select("id, title, start_at, series_exception, series_id").in("series_id", ids).is("deleted_at", null).order("start_at");
  if (error) throw new Error(`read occurrences: ${error.message}`);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  return data.map((e: { id: string; title: string; start_at: string; series_exception: boolean; series_id: string | null }) => ({
    id: e.id, title: e.title, exception: e.series_exception, seriesId: e.series_id, utcStart: e.start_at.slice(11, 16),
    londonStart: fmt.format(new Date(e.start_at)),
  }));
}
/** The media holder (series identity across splits) of an occurrence. */
export async function mediaHolderOf(eventId: string): Promise<string> {
  const ev = await adminClient().from("events").select("series_id").eq("id", eventId).single();
  if (ev.error || !ev.data.series_id) throw new Error(`event ${eventId} is not part of a series`);
  const s = await adminClient().from("event_series").select("media_event_id").eq("id", ev.data.series_id).single();
  if (s.error || !s.data.media_event_id) throw new Error(`series of ${eventId} has no media holder`);
  return s.data.media_event_id;
}
/** Removes every series sharing these media holders: occurrences (live or deleted), series rows and holders. */
export async function deleteSeriesData(mediaEventIds: string[]): Promise<void> {
  if (!mediaEventIds.length) return;
  const series = await adminClient().from("event_series").select("id").in("media_event_id", mediaEventIds);
  if (series.error) throw new Error(`read series: ${series.error.message}`);
  const ids = series.data.map((s: { id: string }) => s.id);
  if (ids.length) {
    const ev = await adminClient().from("events").delete().in("series_id", ids);
    if (ev.error) throw new Error(`delete occurrences: ${ev.error.message}`);
    const sr = await adminClient().from("event_series").delete().in("id", ids);
    if (sr.error) throw new Error(`delete series: ${sr.error.message}`);
  }
  const holders = await adminClient().from("events").delete().in("id", mediaEventIds);
  if (holders.error) throw new Error(`delete media holders: ${holders.error.message}`);
}

/** Removes the stored event-media files of these events, video posters included (Storage first, never with SQL). */
export async function deleteEventFiles(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const videos = await adminClient().from("event_videos").select("thumb_path").in("event_id", ids.slice(i, i + 100)).not("thumb_path", "is", null);
    const posters = (videos.data ?? []).map((v: { thumb_path: string | null }) => v.thumb_path!).filter(Boolean);
    if (posters.length) await adminClient().storage.from("event-media").remove(posters);
  }
  for (const id of ids) {
    const listed = await adminClient().storage.from("event-media").list(id);
    const paths = (listed.data ?? []).map((o) => `${id}/${o.name}`);
    if (paths.length) await adminClient().storage.from("event-media").remove(paths);
  }
}

/** Service-role cleanup: stored files first, then the rows (media and deletion jobs cascade). */
export async function deleteEvents(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await deleteEventFiles(ids);
  const { error } = await adminClient().from("events").delete().in("id", ids);
  if (error) throw new Error(`delete events: ${error.message}`);
}

/**
 * Teardown of test events left by interrupted runs. Deletes ONLY:
 *  1. events created by the given fresh-* users (call this before deleting those users), and
 *  2. events titled with EVENT_TITLE_PREFIX whose creator no longer exists (created_by is NULL because
 *     created_by is ON DELETE SET NULL, i.e. a fresh user deleted before its events),
 *  and then the event_series rows of those users / orphaned "E2E Event …" series.
 * Any other event, including a prefixed one created by a real or seeded user, is never touched.
 */
export async function deleteLeftoverTestEvents(freshUserIds: string[]): Promise<number> {
  let deleted = 0;
  // Registrations of fresh users (on any event); registrations on deleted test events go with them (CASCADE).
  for (let i = 0; i < freshUserIds.length; i += 100) {
    const r = await adminClient().from("event_registrations").delete().in("user_id", freshUserIds.slice(i, i + 100));
    if (r.error) throw new Error(`delete fresh users' registrations: ${r.error.message}`);
  }
  for (let i = 0; i < freshUserIds.length; i += 100) {
    // Meetings' calendar entries go with their meetings (deleteWorkOfUsers), never on their own.
    const own = await adminClient().from("events").select("id").in("created_by", freshUserIds.slice(i, i + 100)).neq("category", "meeting");
    if (own.error) throw new Error(`find fresh users' events: ${own.error.message}`);
    await deleteEventFiles(own.data.map((e: { id: string }) => e.id));
    const { data, error } = await adminClient().from("events").delete().in("created_by", freshUserIds.slice(i, i + 100)).neq("category", "meeting").select("id");
    if (error) throw new Error(`delete fresh users' events: ${error.message}`);
    deleted += data?.length ?? 0;
  }
  const orphaned = await adminClient().from("events").select("id").like("title", `${EVENT_TITLE_PREFIX}%`).is("created_by", null).neq("category", "meeting");
  if (orphaned.error) throw new Error(`find orphaned test events: ${orphaned.error.message}`);
  await deleteEventFiles(orphaned.data.map((e: { id: string }) => e.id));
  const { data, error } = await adminClient().from("events").delete().like("title", `${EVENT_TITLE_PREFIX}%`).is("created_by", null).neq("category", "meeting").select("id");
  if (error) throw new Error(`delete orphaned test events: ${error.message}`);
  // Series rows of the same users / orphaned test series (their events are gone by now).
  for (let i = 0; i < freshUserIds.length; i += 100) {
    const s = await adminClient().from("event_series").delete().in("created_by", freshUserIds.slice(i, i + 100));
    if (s.error) throw new Error(`delete fresh users' series: ${s.error.message}`);
  }
  const orphans = await adminClient().from("event_series").delete().like("title", `${EVENT_TITLE_PREFIX}%`).is("created_by", null);
  if (orphans.error) throw new Error(`delete orphaned test series: ${orphans.error.message}`);
  return deleted + (data?.length ?? 0);
}

/**
 * A guest registration confirmed by email, created like the public form does (service role: guest_register, then
 * guest_confirm as the email link would). Removed with its event (CASCADE).
 */
export async function addConfirmedGuest(eventId: string, guest: { name: string; email: string; phone?: string; places?: number }) {
  const reg = await adminClient().rpc("guest_register", {
    p_event: eventId, p_name: guest.name, p_email: guest.email, p_phone: guest.phone ?? "", p_places: guest.places ?? 1, p_keep_informed: false,
  });
  if (reg.error) throw new Error(`guest_register: ${reg.error.message}`);
  const id = (reg.data as { registration_id: string | null }).registration_id;
  if (!id) throw new Error(`guest_register gave no registration (${JSON.stringify(reg.data)})`);
  const confirmed = await adminClient().rpc("guest_confirm", { p_registration: id });
  if (confirmed.error) throw new Error(`guest_confirm: ${confirmed.error.message}`);
  return { registrationId: id, status: (confirmed.data as { status: string }).status };
}

/** Moves a timed event so it started `minutesAgo` minutes ago and lasts `durationMinutes` (service role). */
export async function startEventMinutesAgo(eventId: string, minutesAgo: number, durationMinutes = 120) {
  const start = new Date(Date.now() - minutesAgo * 60_000);
  const { error } = await adminClient().from("events").update({
    start_at: start.toISOString(), end_at: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
  }).eq("id", eventId);
  if (error) throw new Error(`move event ${eventId}: ${error.message}`);
}
