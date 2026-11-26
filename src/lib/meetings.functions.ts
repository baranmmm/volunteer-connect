import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  MEETING_FILE_BUCKET,
  MEETING_SERIES_MODES,
  MEETING_STATUSES,
  meeting,
  meetingCreateInput,
  meetingDetail,
  meetingInput,
  meetingSeriesTask,
  carryOverChoice,
  carryOverMeeting,
} from "./meetings";
import { person, WORK_SCOPES } from "./tasks";

/** Sends the notice emails an action just queued (assignments, invitations, requests waiting). */
const flushNoticeEmails = async () =>
  (await import("@/lib/notice-emails.server")).flushNoticeEmails();

// Every write is a SECURITY DEFINER RPC; reads go through visibility-checked RPCs (creator, invitees, scope managers).
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const meetingId = z.object({ id: z.string().uuid() });

export const listMeetings = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      when: z.enum(["upcoming", "past"]),
      limit: z.number().int().min(1).max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_meetings", {
      p_when: data.when,
      p_limit: data.limit ?? 200,
    });
    fail(result.error);
    return z.array(meeting).parse(result.data ?? []);
  });

/** One meeting with agenda, decisions, invitees and files (signed for five minutes). null when not visible. */
export const getMeeting = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(meetingId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_meeting", { p_id: data.id });
    fail(result.error);
    if (result.data === null) return null;
    const detail = meetingDetail.parse(result.data);
    // Signed with the user's token (Storage policies check the meeting again); downloads keep the original name.
    detail.files = await Promise.all(
      detail.files.map(async (f) => {
        const signed = await context.supabase.storage
          .from(MEETING_FILE_BUCKET)
          .createSignedUrl(f.storage_path, 300, { download: f.original_name });
        const raw = signed.data?.signedUrl;
        const url = raw
          ? `${import.meta.env["VITE_SUPABASE_URL"]}${new URL(raw).pathname}${new URL(raw).search}`
          : null;
        return { ...f, url };
      }),
    );
    return detail;
  });

export const createMeeting = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingCreateInput.extend({ scope: z.enum(WORK_SCOPES) }))
  .handler(async ({ data, context }) => {
    // Creates the calendar entry too; with recurrence, every occurrence (each with its own entry).
    const result = await context.supabase.rpc("create_meeting", { p: data });
    fail(result.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });

export const updateMeeting = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId.extend({ meeting: meetingInput }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_meeting", { p_id: data.id, p: data.meeting });
    fail(result.error);
    await flushNoticeEmails();
    return { ok: true };
  });

export const setMeetingStatus = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId.extend({ status: z.enum(MEETING_STATUSES) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_meeting_status", {
      p_id: data.id,
      p_status: data.status,
    });
    fail(result.error);
    return { ok: true };
  });

export const deleteMeeting = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_meeting", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });

export const listMeetingPeople = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      scope: z.enum(WORK_SCOPES),
      branchId: z.string().uuid().nullable(),
      regionId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_meeting_people", {
      p_scope: data.scope,
      ...(data.branchId ? { p_branch: data.branchId } : {}),
      ...(data.regionId ? { p_region: data.regionId } : {}),
    });
    fail(result.error);
    return z.array(person).parse(result.data ?? []);
  });

// Agenda and decisions -----------------------------------------------------------------------------------------
const text = (max: number) => z.string().trim().min(1).max(max);
export const addAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      meetingId: z.string().uuid(),
      title: text(200),
      notes: z.string().max(5000).nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_agenda_item", {
      p_meeting: data.meetingId,
      p_title: data.title,
      ...(data.notes ? { p_notes: data.notes } : {}),
    });
    fail(result.error);
    return z.string().uuid().parse(result.data);
  });
export const updateAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ id: z.string().uuid(), title: text(200), notes: z.string().max(5000).nullable() }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_agenda_item", {
      p_id: data.id,
      p_title: data.title,
      ...(data.notes ? { p_notes: data.notes } : {}),
    });
    fail(result.error);
    return { ok: true };
  });
export const deleteAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_agenda_item", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });
export const moveAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ id: z.string().uuid(), direction: z.union([z.literal(-1), z.literal(1)]) }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("move_agenda_item", {
      p_id: data.id,
      p_direction: data.direction,
    });
    fail(result.error);
    return { ok: true };
  });
export const addMeetingDecision = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ itemId: z.string().uuid(), text: text(2000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_meeting_decision", {
      p_item: data.itemId,
      p_text: data.text,
    });
    fail(result.error);
    return z.string().uuid().parse(result.data);
  });
export const updateMeetingDecision = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), text: text(2000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_meeting_decision", {
      p_id: data.id,
      p_text: data.text,
    });
    fail(result.error);
    return { ok: true };
  });
export const deleteMeetingDecision = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_meeting_decision", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });

// Files: reserve a slot (row + storage path), then the browser uploads to that path. Removal: Storage object first
// (browser, Storage policy checks edit rights), then the row.
export const reserveMeetingFile = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      meetingId: z.string().uuid(),
      extension: z.string().min(1).max(10),
      originalName: z.string().max(255),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_meeting_file", {
      p_meeting: data.meetingId,
      p_extension: data.extension,
      p_original_name: data.originalName,
    });
    fail(result.error);
    return z.object({ id: z.string().uuid(), storage_path: z.string() }).parse(result.data);
  });
export const deleteMeetingFile = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_meeting_file", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });

// Recurring meetings, agenda follow-up, invitees -----------------------------------------------------------------

/** Edit a meeting: this occurrence, this and following, or all (one meeting when it is not recurring). */
export const updateMeetingSeries = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId.extend({ mode: z.enum(MEETING_SERIES_MODES), meeting: meetingInput }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_meeting_series", {
      p_id: data.id,
      p_mode: data.mode,
      p: data.meeting,
    });
    fail(result.error);
    return { count: z.number().parse(result.data) };
  });
/** Delete this occurrence, this and following, or all (each occurrence goes to the Recycle Bin). */
export const deleteMeetingSeries = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId.extend({ mode: z.enum(MEETING_SERIES_MODES) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_meeting_series", {
      p_id: data.id,
      p_mode: data.mode,
    });
    fail(result.error);
    return { count: z.number().parse(result.data) };
  });
/** The series' standing agenda items; new ones are added to the upcoming occurrences. */
export const setMeetingSeriesAgenda = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId.extend({ titles: z.array(text(200)).max(30) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_meeting_series_agenda", {
      p_id: data.id,
      p_titles: data.titles,
    });
    fail(result.error);
    return { updated: z.number().parse(result.data) };
  });
/** Several agenda items at once (the create form's agenda section). */
export const addAgendaItems = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ meetingId: z.string().uuid(), titles: z.array(text(200)).max(30) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_agenda_items", {
      p_meeting: data.meetingId,
      p_titles: data.titles,
    });
    fail(result.error);
    return { added: z.number().parse(result.data) };
  });
export const setAgendaItemResolved = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), resolved: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_agenda_item_resolved", {
      p_id: data.id,
      p_resolved: data.resolved,
    });
    fail(result.error);
    return { resolved: z.boolean().parse(result.data) };
  });
/** Invitees only (the event form of a meeting's calendar entry). New invitees are notified. */
export const setMeetingInvitees = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingId.extend({ inviteeIds: z.array(z.string().uuid()).max(100) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_meeting_invitees", {
      p_id: data.id,
      p_invitee_ids: data.inviteeIds,
    });
    fail(result.error);
    await flushNoticeEmails();
    return { added: z.number().parse(result.data) };
  });
/** Every task created from a decision in the meeting's series (visible ones only). */
export const getMeetingSeriesTasks = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(meetingId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_meeting_series_tasks", { p_id: data.id });
    fail(result.error);
    return z.array(meetingSeriesTask).parse(result.data ?? []);
  });

// Carry-over --------------------------------------------------------------------------------------------------

/** Unresolved agenda items of earlier meetings in this scope (that the caller may edit), with decisions and open tasks. */
export const listMeetingCarryOver = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      scope: z.enum(WORK_SCOPES),
      branchId: z.string().uuid().nullable(),
      regionId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_meeting_carry_over", {
      p_scope: data.scope,
      ...(data.branchId ? { p_branch: data.branchId } : {}),
      ...(data.regionId ? { p_region: data.regionId } : {}),
    });
    fail(result.error);
    return z.array(carryOverMeeting).parse(result.data ?? []);
  });

/**
 * Copies the chosen items and decisions into the meeting and moves the chosen open tasks to the new decisions, in
 * one transaction (carry_over_agenda). Returns how many items.
 */
export const carryOverAgenda = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ meetingId: z.string().uuid(), items: z.array(carryOverChoice).min(1).max(50) }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("carry_over_agenda", {
      p_meeting: data.meetingId,
      p: data.items,
    });
    fail(result.error);
    return { count: z.number().parse(result.data) };
  });
