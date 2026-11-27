import { z } from "zod";
import { linkedTask, person, WORK_SCOPES } from "./tasks";

// Shared (client and server) meeting schemas, file rules and helpers. Visibility and editing are decided by the
// database (can_view_meeting / can_edit_meeting); can_edit only drives the UI.

export const MEETING_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const LOCATION_TYPES = ["in_person", "online"] as const;

export const meeting = z.object({
  id: z.string().uuid(),
  scope: z.enum(WORK_SCOPES),
  branch_id: z.string().uuid().nullable(),
  region_id: z.string().uuid().nullable(),
  branch: z.string().nullable(),
  region: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  location_type: z.enum(LOCATION_TYPES),
  location: z.string().nullable(),
  online_url: z.string().nullable(),
  status: z.enum(MEETING_STATUSES),
  created_by: z.string().uuid().nullable(),
  created_by_name: z.string().nullable(),
  invitee_count: z.number(),
  invited: z.boolean(),
  can_edit: z.boolean(),
  /** The meeting's calendar entry (an event with category "meeting"): /events/<event_id>. */
  event_id: z.string().uuid(),
  series_id: z.string().uuid().nullable(),
  series_position: z.number().nullable(),
  series_count: z.number().nullable(),
});
export type Meeting = z.infer<typeof meeting>;

export const meetingDecision = z.object({
  id: z.string().uuid(),
  text: z.string(),
  created_at: z.string(),
  tasks: z.array(linkedTask),
});
export const agendaItem = z.object({
  id: z.string().uuid(),
  position: z.number(),
  title: z.string(),
  notes: z.string().nullable(),
  /** Resolved items do not show under "From last meeting" in the next occurrence. */
  resolved: z.boolean(),
  /** Copied from the series agenda template. */
  standing: z.boolean(),
  decisions: z.array(meetingDecision),
});
export const meetingFile = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "pdf", "document"]),
  storage_path: z.string(),
  original_name: z.string(),
  created_at: z.string(),
});
export const MEETING_REPEAT_FREQS = ["weekly", "monthly"] as const;
export type MeetingRepeatFreq = (typeof MEETING_REPEAT_FREQS)[number];
export const MAX_MEETING_OCCURRENCES = 52;
export const meetingSeries = z.object({
  id: z.string().uuid(),
  freq: z.enum(MEETING_REPEAT_FREQS),
  interval: z.number(),
  count: z.number(),
  agenda_template: z.array(z.string()),
  previous_id: z.string().uuid().nullable(),
  next_id: z.string().uuid().nullable(),
});
export const seriesTask = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(["todo", "in_progress", "blocked", "done"]),
  due_date: z.string().nullable(),
  assignees: z.array(z.string().nullable()),
});
/** "From last meeting": the previous occurrence's unresolved agenda items and its open tasks (live). */
export const fromLastMeeting = z.object({
  meeting_id: z.string().uuid(),
  title: z.string(),
  starts_at: z.string(),
  items: z.array(
    z.object({ id: z.string().uuid(), title: z.string(), notes: z.string().nullable() }),
  ),
  tasks: z.array(seriesTask),
});
export const meetingDetail = meeting.extend({
  invitees: z.array(person),
  agenda: z.array(agendaItem),
  files: z.array(meetingFile.extend({ url: z.string().nullable().optional() })),
  series: meetingSeries.nullable(),
  from_last: fromLastMeeting.nullable(),
});
/** get_meeting_series_tasks: every task created from the series' decisions, with its occurrence. */
export const meetingSeriesTask = seriesTask.extend({
  meeting_id: z.string().uuid(),
  meeting_starts_at: z.string(),
});
export type MeetingSeriesTask = z.infer<typeof meetingSeriesTask>;
export type FromLastMeeting = z.infer<typeof fromLastMeeting>;
export type MeetingDetail = z.infer<typeof meetingDetail>;
export type AgendaItem = z.infer<typeof agendaItem>;
export type MeetingFile = z.infer<typeof meetingFile> & { url?: string | null | undefined };

export const meetingInput = z.object({
  scope: z.enum(WORK_SCOPES).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  region_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  location_type: z.enum(LOCATION_TYPES),
  location: z.string().max(300).nullable().optional(),
  online_url: z.string().max(500).nullable().optional(),
  invitee_ids: z.array(z.string().uuid()).max(100).optional(),
});
export type MeetingInput = z.infer<typeof meetingInput>;
/** Create only: agenda titles of the form, and the repeat settings of a recurring meeting. */
export const meetingRecurrence = z.object({
  freq: z.enum(MEETING_REPEAT_FREQS),
  interval: z.number().int().min(1).max(4),
  count: z.number().int().min(2).max(MAX_MEETING_OCCURRENCES),
});
export type MeetingRecurrence = z.infer<typeof meetingRecurrence>;
export const meetingCreateInput = meetingInput.extend({
  agenda: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  recurrence: meetingRecurrence.nullable().optional(),
});
export type MeetingCreateInput = z.infer<typeof meetingCreateInput>;
/** Edit scopes of a recurring meeting, as for recurring events. */
export const MEETING_SERIES_MODES = ["this", "following", "all"] as const;
export type MeetingSeriesMode = (typeof MEETING_SERIES_MODES)[number];

/**
 * Carry-over candidates (list_meeting_carry_over for a new meeting, list_meeting_carry_in for an existing one): the
 * unresolved agenda items of other meetings of the same place (past or upcoming) that the caller may edit, newest
 * meeting first. A chain of copies shows once, as its latest copy, and never when the meeting already has a copy. Each
 * comes with its decisions and the decisions' not-done tasks (shared along the chain, never moved).
 */
export const carryOverMeeting = z.object({
  meeting_id: z.string().uuid(),
  meeting_title: z.string(),
  starts_at: z.string(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      notes: z.string().nullable(),
      decisions: z.array(
        z.object({
          id: z.string().uuid(),
          text: z.string(),
          tasks: z.array(
            z.object({
              id: z.string().uuid(),
              title: z.string(),
              status: z.enum(["todo", "in_progress", "blocked", "done"]),
              group_id: z.string().uuid().nullable(),
              assignees: z.array(z.string().nullable()),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type CarryOverMeeting = z.infer<typeof carryOverMeeting>;
export type CarryOverItem = CarryOverMeeting["items"][number];
/**
 * What carry_over_agenda receives: per chosen item, the chosen decisions. Tasks are never moved (20261221090000): the
 * copies show their original decisions' tasks, so task_ids stays empty (the database ignores it).
 */
export const carryOverChoice = z.object({
  item_id: z.string().uuid(),
  decision_ids: z.array(z.string().uuid()).max(50),
  task_ids: z.array(z.string().uuid()).max(500),
});
export type CarryOverChoice = z.infer<typeof carryOverChoice>;

/** Everything of an item: every decision (the default when an item is ticked). */
export function fullCarryOver(item: CarryOverItem): CarryOverChoice {
  return { item_id: item.id, decision_ids: item.decisions.map((d) => d.id), task_ids: [] };
}
/** Folds case, accents and the Turkish dotless i, so "cikis" finds "Çıkış". */
export function carrySearchKey(text: string): string {
  return text.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
}

/**
 * The picker's search: items whose title or any decision text contains every word of the query; meetings without a
 * match drop out. An empty query keeps everything.
 */
export function filterCarryOver(meetings: CarryOverMeeting[], query: string): CarryOverMeeting[] {
  const words = carrySearchKey(query).split(/\s+/).filter(Boolean);
  if (!words.length) return meetings;
  return meetings
    .map((m) => ({
      ...m,
      items: m.items.filter((item) => {
        const hay = carrySearchKey([item.title, ...item.decisions.map((d) => d.text)].join("\n"));
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((m) => m.items.length > 0);
}

/** Ticks or unticks one decision of a chosen item. */
export function toggleCarryDecision(
  choice: CarryOverChoice,
  decisionId: string,
  on: boolean,
): CarryOverChoice {
  return {
    ...choice,
    decision_ids: on
      ? [...new Set([...choice.decision_ids, decisionId])]
      : choice.decision_ids.filter((x) => x !== decisionId),
  };
}

/** How many recent past meetings and next upcoming meetings the /meetings timeline shows without expanding. */
export const TIMELINE_RECENT_PAST = 2;
export const TIMELINE_NEXT_UPCOMING = 3;
/**
 * The /meetings timeline, oldest first in every part: `earlier` (older past meetings, collapsed), `recent` (the two
 * most recent past ones, shown faded), `next` (the next three upcoming, prominent) and `later` (the rest of the
 * upcoming ones, collapsed). Inputs: list_meetings('upcoming') (soonest first) and list_meetings('past') (latest first).
 */
export function meetingTimeline<T extends { id: string; starts_at: string }>(
  upcoming: readonly T[],
  past: readonly T[],
) {
  const byStart = (a: T, b: T) =>
    Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id);
  const pastAsc = [...past].sort(byStart);
  const upcomingAsc = [...upcoming].sort(byStart);
  const split = Math.max(0, pastAsc.length - TIMELINE_RECENT_PAST);
  return {
    earlier: pastAsc.slice(0, split),
    recent: pastAsc.slice(split),
    next: upcomingAsc.slice(0, TIMELINE_NEXT_UPCOMING),
    later: upcomingAsc.slice(TIMELINE_NEXT_UPCOMING),
  };
}

export type MeetingFormErrors = Partial<
  Record<"title" | "start" | "end" | "location" | "online_url", string>
>;
/** Form rules (the database checks them again). Error values are i18n keys. */
export function validateMeetingForm(v: {
  title: string;
  start: Date | null;
  end: Date | null;
  location_type: "in_person" | "online";
  location: string;
  online_url: string;
}): MeetingFormErrors {
  const errors: MeetingFormErrors = {};
  if (!v.title.trim()) errors.title = "meetings.errors.title";
  if (!v.start) errors.start = "meetings.errors.start";
  if (!v.end) errors.end = "meetings.errors.end";
  else if (v.start && v.end <= v.start) errors.end = "meetings.errors.endAfterStart";
  else if (v.start && v.end.getTime() - v.start.getTime() > 7 * 86400000)
    errors.end = "meetings.errors.tooLong";
  if (v.location_type === "in_person" && !v.location.trim())
    errors.location = "meetings.errors.location";
  if (v.location_type === "online" && !/^https:\/\/\S+$/.test(v.online_url.trim()))
    errors.online_url = "meetings.errors.onlineUrl";
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// Files: private bucket meeting-files, 25 MB per file; PDF, JPEG/PNG/WebP, DOCX, PPTX, XLSX.

export const MEETING_FILE_BUCKET = "meeting-files";
export const MAX_MEETING_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_MEETING_FILES = 20;
const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
export const MEETING_FILE_ACCEPT = [
  ...Object.keys(MIME_EXT),
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
].join(",");
export function meetingFileExtension(type: string, name: string): string | null {
  if (MIME_EXT[type]) return MIME_EXT[type]!;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpeg") return "jpg";
  return Object.values(MIME_EXT).includes(ext) ? ext : null;
}
export function meetingFileContentType(ext: string) {
  return Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
}
/** null when the file may be uploaded; otherwise an i18n key. */
export function validateMeetingFile(
  file: { type: string; name: string; size: number },
  count: number,
) {
  if (count >= MAX_MEETING_FILES) return "meetings.files.tooMany";
  if (!meetingFileExtension(file.type, file.name)) return "meetings.files.badType";
  if (file.size > MAX_MEETING_FILE_BYTES) return "meetings.files.tooLarge";
  return null;
}
