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
  decisions: z.array(meetingDecision),
});
export const meetingFile = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "pdf", "document"]),
  storage_path: z.string(),
  original_name: z.string(),
  created_at: z.string(),
});
export const meetingDetail = meeting.extend({
  invitees: z.array(person),
  agenda: z.array(agendaItem),
  files: z.array(meetingFile.extend({ url: z.string().nullable().optional() })),
});
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
