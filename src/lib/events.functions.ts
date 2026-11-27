import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { EventMedia, HubEvent, EventRow, MediaRow } from "./event-rules";
import { normalizeEventExtension } from "./event-rules";
import { eventDeletionState } from "./event-deletion";
import { imageVariantPaths } from "./image-variants";
import type { SeriesInfo } from "./recurrence";
import type { RegistrationStatus } from "./registrations";

/** Sends the update / cancellation emails the change queued (non-fatal; server only). */
async function flushEmails() {
  const { flushEventEmails } = await import("./event-emails.server");
  await flushEventEmails(1);
}

async function active(client: SupabaseClient<Database>, uid: string) {
  const { data, error } = await client.from("profiles").select("status").eq("id", uid).single();
  if (error || data.status !== "active") throw new Error("Not allowed");
}
/** Chunks of `size`, for `.in()` filters and Storage batches. */
const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

/** Browser-facing signed links of one createSignedUrls batch per 100 paths (all batches in parallel). */
async function signEventPaths(client: SupabaseClient<Database>, paths: string[], seconds: number) {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths)];
  const batches = await Promise.all(
    chunks(unique, 100).map((batch) =>
      client.storage.from("event-media").createSignedUrls(batch, seconds),
    ),
  );
  for (const result of batches) {
    if (result.error) throw result.error;
    for (const item of result.data) {
      if (item.error || !item.signedUrl || !item.path) continue;
      // Keep browser-facing URLs on the browser's Supabase origin, not a server-only endpoint.
      const raw = new URL(item.signedUrl);
      urls.set(item.path, `${import.meta.env["VITE_SUPABASE_URL"]}${raw.pathname}${raw.search}`);
    }
  }
  return urls;
}

/** The media rows of events (series occurrences: their series' holder event), in position order; RLS decides. */
async function mediaRows(
  client: SupabaseClient<Database>,
  events: Pick<EventRow, "id" | "series_id">[],
) {
  // Occurrences of a series show the series' files, held by its media holder event (RLS: can_view_event_media).
  const seriesIds = [...new Set(events.flatMap((e) => (e.series_id ? [e.series_id] : [])))];
  const holderOf = new Map<string, string>();
  const series = await Promise.all(
    chunks(seriesIds, 100).map((ids) =>
      client.from("event_series").select("id, media_event_id").in("id", ids),
    ),
  );
  for (const result of series) {
    if (result.error) throw result.error;
    for (const s of result.data) if (s.media_event_id) holderOf.set(s.id, s.media_event_id);
  }
  const ownerOf = (e: Pick<EventRow, "id" | "series_id">) =>
    (e.series_id && holderOf.get(e.series_id)) || e.id;
  const owners = [...new Set(events.map(ownerOf))];
  const pages = await Promise.all(
    chunks(owners, 100).map((ids) =>
      client.from("event_media").select("*").in("event_id", ids).order("position").order("id"),
    ),
  );
  const media: MediaRow[] = [];
  for (const result of pages) {
    if (result.error) throw result.error;
    media.push(...result.data);
  }
  return { media, ownerOf };
}

/**
 * Events with their media rows. `sign`: signed links for every file (one event's page); lists pass false and the
 * cards ask getEventCovers for the covers they show, so a list never signs files it does not display.
 */
async function withMedia(
  client: SupabaseClient<Database>,
  events: EventRow[],
  { sign }: { sign: boolean },
): Promise<HubEvent[]> {
  if (!events.length) return [];
  const { media, ownerOf } = await mediaRows(client, events);
  const urls = sign
    ? await signEventPaths(
        client,
        media.map((m) => m.storage_path),
        300,
      )
    : null;
  const rows: EventMedia[] = media.map((m) => ({ ...m, url: urls?.get(m.storage_path) ?? null }));
  return events.map((e) => ({
    ...e,
    media: rows.filter((m) => m.event_id === ownerOf(e)).sort((a, b) => a.position - b.position),
  }));
}

/** Signed links last 10 minutes; the client keeps covers 4 minutes (the events list's staleTime). */
const COVER_SECONDS = 600;
export const MAX_COVER_IDS = 100;
export const listEvents = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    await active(context.supabase, context.userId);
    const events: EventRow[] = [];
    for (let offset = 0; ; offset += 200) {
      const result = await context.supabase
        .from("events")
        .select("*")
        .order("start_at")
        .order("id")
        .range(offset, offset + 199);
      if (result.error) throw result.error;
      events.push(...result.data);
      if (result.data.length < 200) break;
    }
    // The viewer's own registration status per event (RLS: own rows only), for the Registered/Waitlisted badges.
    const mine = new Map<string, string>();
    for (let offset = 0; ; offset += 1000) {
      const result = await context.supabase
        .from("event_registrations")
        .select("event_id, status")
        .eq("user_id", context.userId)
        .in("status", ["registered", "waitlisted", "attended"])
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw result.error;
      for (const r of result.data) mine.set(r.event_id, r.status);
      if (result.data.length < 1000) break;
    }
    // Meetings' calendar entries: the meeting each links to (RLS: only meetings the viewer can see).
    const meetingOf = new Map<string, string>();
    const meetingEvents = events.filter((e) => e.category === "meeting").map((e) => e.id);
    for (let i = 0; i < meetingEvents.length; i += 200) {
      const result = await context.supabase
        .from("meetings")
        .select("id, event_id")
        .in("event_id", meetingEvents.slice(i, i + 200));
      if (result.error) throw result.error;
      for (const m of result.data) meetingOf.set(m.event_id, m.id);
    }
    return (await withMedia(context.supabase, events, { sign: false })).map((e) => ({
      ...e,
      my_registration: (mine.get(e.id) ?? null) as RegistrationStatus | null,
      meeting_id: meetingOf.get(e.id) ?? null,
    }));
  });
/**
 * The cover (first image) of each listed event the viewer can see, as a signed link to its 640 copy (the original
 * when it has no copies): one Storage batch for the cards a page shows. Events without an image are left out.
 */
export const getEventCovers = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ ids: z.array(z.string().uuid()).max(MAX_COVER_IDS) }))
  .handler(async ({ data, context }): Promise<Record<string, string>> => {
    const ids = [...new Set(data.ids)];
    if (!ids.length) return {};
    const events = await context.supabase.from("events").select("id, series_id").in("id", ids);
    if (events.error) throw events.error;
    const { media, ownerOf } = await mediaRows(context.supabase, events.data);
    const coverOf = new Map<string, MediaRow>();
    for (const m of media)
      if (m.kind === "image" && !coverOf.has(m.event_id)) coverOf.set(m.event_id, m);
    const pathOf = new Map<string, string>();
    for (const e of events.data) {
      const cover = coverOf.get(ownerOf(e));
      if (cover)
        pathOf.set(
          e.id,
          cover.has_variants ? imageVariantPaths(cover.storage_path).w640 : cover.storage_path,
        );
    }
    const urls = await signEventPaths(context.supabase, [...pathOf.values()], COVER_SECONDS);
    const result: Record<string, string> = {};
    for (const [id, path] of pathOf) {
      const url = urls.get(path);
      if (url) result[id] = url;
    }
    return result;
  });
export const getEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await active(context.supabase, context.userId);
    const result = await context.supabase
      .from("events")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    const manage = await context.supabase.rpc("get_event_deletion_state", { _event: data.id });
    if (manage.error) throw manage.error;
    const deletion = eventDeletionState.parse(manage.data);
    const [branch, region] = await Promise.all([
      result.data.branch_id
        ? context.supabase
            .from("branches")
            .select("name")
            .eq("id", result.data.branch_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      result.data.region_id
        ? context.supabase
            .from("regions")
            .select("name")
            .eq("id", result.data.region_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (branch.error) throw branch.error;
    if (region.error) throw region.error;
    // Series details (rule, EXDATEs); opening also extends the series' 12-month horizon.
    let series: SeriesInfo | null = null;
    if (result.data.series_id) {
      const opened = await context.supabase.rpc("open_series", { _series: result.data.series_id });
      if (!opened.error) series = seriesInfo.parse(opened.data);
    }
    // A meeting's calendar entry links to its meeting ("Open meeting").
    let meetingId: string | null = null;
    if (result.data.category === "meeting") {
      const m = await context.supabase
        .from("meetings")
        .select("id")
        .eq("event_id", data.id)
        .maybeSingle();
      if (m.error) throw m.error;
      meetingId = m.data?.id ?? null;
    }
    return {
      event: (await withMedia(context.supabase, [result.data], { sign: true }))[0] ?? null,
      meetingId,
      canManage: deletion.canManage,
      deletion,
      branchName: branch.data?.name ?? null,
      regionName: region.data?.name ?? null,
      series,
    };
  });
export const eventBranches = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    await active(context.supabase, context.userId);
    const roles = await context.supabase
      .from("user_roles")
      .select("role,region_id")
      .eq("user_id", context.userId);
    if (roles.error) throw roles.error;
    // National Coordinators create national events only (no branch).
    if (roles.data.some((r) => r.role === "national_coordinator")) return [];
    const director = roles.data.find((r) => r.role === "regional_director");
    let query = context.supabase.from("branches").select("id,name").order("name");
    if (director?.region_id) query = query.eq("region_id", director.region_id);
    else {
      if (!roles.data.some((r) => r.role === "branch_manager")) throw new Error("Not allowed");
      const profile = await context.supabase
        .from("profiles")
        .select("branch_id")
        .eq("id", context.userId)
        .single();
      if (profile.error || !profile.data.branch_id) return [];
      query = query.eq("id", profile.data.branch_id);
    }
    const result = await query;
    if (result.error) throw result.error;
    return result.data;
  });
const seriesInfo = z.object({
  id: z.string().uuid(),
  rule: z.string(),
  timezone: z.string(),
  all_day: z.boolean(),
  dtstart_local: z.string(),
  duration_minutes: z.number().nullable(),
  span_days: z.number(),
  status: z.string(),
  media_event_id: z.string().uuid().nullable(),
  exdates: z.array(z.string()),
});
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const input = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10000),
    location: z.string().max(500),
    location_type: z.enum(["in_person", "online"]),
    online_url: z.string().trim().max(2000).nullable(),
    organizer: z.string().trim().max(200),
    category: z.enum(["dialogue", "dinner", "interfaith", "community", "education", "other"]),
    all_day: z.boolean(),
    start_date: dateOnly.nullable(),
    end_date: dateOnly.nullable(),
    start_at: z.string().datetime().nullable(),
    end_at: z.string().datetime().nullable(),
    capacity: z.number().int().positive().nullable(),
    registration_enabled: z.boolean(),
    // An in-person place may be "To be announced" (date and time stay required); places one registration may book.
    location_tba: z.boolean().default(false),
    max_places: z.number().int().min(1).max(10).default(1),
    audience: z.enum(["public", "members"]).default("members"),
    scope: z.enum(["branch", "region", "national"]),
    branch_id: z.string().uuid().nullable(),
    status: z.enum(["draft", "published", "cancelled"]),
  })
  .superRefine((event, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (event.online_url && !/^https:\/\/[^\s/?#]+\.[^\s]*$/.test(event.online_url))
      issue("online_url", "Online meeting link must use https");
    if (
      !event.all_day &&
      event.start_at &&
      event.end_at &&
      Date.parse(event.end_at) <= Date.parse(event.start_at)
    )
      issue("end_at", "Event end must be after start");
    if (event.all_day && event.start_date && event.end_date && event.end_date < event.start_date)
      issue("end_date", "Event end must be after start");
    if (event.status !== "draft") {
      if (event.all_day ? !event.start_date : !event.start_at || !event.end_at)
        issue("start_at", "Required publish fields missing");
      if (
        event.location_type === "in_person"
          ? !event.location.trim() && !event.location_tba
          : !event.online_url
      )
        issue("location", "Required publish fields missing");
      if (event.scope === "branch" && !event.branch_id)
        issue("branch_id", "Required publish fields missing");
    }
  });
export const saveEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid().nullable(), event: input }))
  .handler(async ({ data, context }) => {
    const result = data.id
      ? await context.supabase.rpc("update_event", { _event: data.id, _data: data.event })
      : await context.supabase.rpc("create_event", { _data: data.event });
    if (result.error) throw new Error(result.error.message);
    if (data.id) await flushEmails();
    return data.id ?? String(result.data);
  });
const rrule = z
  .string()
  .trim()
  .min(10)
  .max(500)
  .regex(/^FREQ=[A-Z0-9=;,+-]+$/);
const seriesResult = z.object({
  series_id: z.string().uuid(),
  event_id: z.string().uuid(),
  media_event_id: z.string().uuid().nullable().optional(),
  kept_off_rule: z.array(z.string().uuid()).optional(),
});
/** Creates a series and its first occurrences (at most 100, 12 months ahead); returns the first occurrence. */
export const createSeries = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ event: input, rule: rrule }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("create_series", {
      _data: data.event,
      _rule: data.rule,
    });
    if (result.error) throw new Error(result.error.message);
    const parsed = seriesResult.parse(result.data);
    return {
      seriesId: parsed.series_id,
      eventId: parsed.event_id,
      mediaEventId: parsed.media_event_id ?? null,
    };
  });
/** Edits one occurrence ('this'), this and the following ones ('following') or the whole series ('all'). */
export const updateSeriesEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      mode: z.enum(["this", "following", "all"]),
      event: input,
      rule: rrule.nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_series_event", {
      _event: data.id,
      _mode: data.mode,
      _data: data.event,
      ...(data.rule ? { _rule: data.rule } : {}),
    });
    if (result.error) throw new Error(result.error.message);
    const parsed = seriesResult.parse(result.data);
    await flushEmails();
    // Registered occurrences the new rule no longer produces are kept as exceptions; the form warns about them.
    return {
      seriesId: parsed.series_id,
      eventId: parsed.event_id,
      keptOffRule: parsed.kept_off_rule ?? [],
    };
  });
export const cancelEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("cancel_event", { _event: data.id });
    if (result.error) throw new Error(result.error.message);
    await flushEmails();
  });
export const reserveEventMedia = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      eventId: z.string().uuid(),
      kind: z.enum(["image", "pdf", "document"]),
      extension: z.enum(["jpg", "jpeg", "png", "webp", "pdf", "docx", "pptx"]),
      originalName: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_event_media", {
      _event: data.eventId,
      _kind: data.kind,
      _extension: normalizeEventExtension(data.extension),
      _original_name: data.originalName ?? "",
    });
    if (result.error) throw new Error(result.error.message);
    const row = await context.supabase
      .from("event_media")
      .select("*")
      .eq("id", result.data)
      .single();
    if (row.error) throw row.error;
    return row.data;
  });
export const reorderEventMedia = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid(), ids: z.array(z.string().uuid()).max(12) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("reorder_event_media", {
      _event: data.eventId,
      _ids: data.ids,
    });
    if (result.error) throw new Error(result.error.message);
  });
export const deleteEventMedia = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_event_media", { _media: data.id });
    if (result.error) throw new Error(result.error.message);
  });
/** The re-encoded size of an uploaded image (the landing gallery lays photos out without loading them). */
export const setEventMediaSize = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      width: z.number().int().min(1).max(10000),
      height: z.number().int().min(1).max(10000),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_event_media_size", {
      p_media: data.id,
      p_width: data.width,
      p_height: data.height,
    });
    if (result.error) throw new Error(result.error.message);
  });
/** After both resized copies of an image are stored: set_event_media_variants checks them in Storage and sets has_variants. */
export const setEventMediaVariants = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_event_media_variants", { p_media: data.id });
    if (result.error) throw new Error(result.error.message);
  });
/** "Show in public gallery" for a photo of a public event. */
export const setEventMediaGallery = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), inGallery: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_event_media_gallery", {
      p_media: data.id,
      p_in_gallery: data.inGallery,
    });
    if (result.error) throw new Error(result.error.message);
  });
