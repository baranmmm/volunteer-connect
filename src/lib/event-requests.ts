import { z } from "zod";
import { londonInput, londonToIso } from "./event-rules";
import { ONLINE_URL } from "./event-form-rules";
import { EVENT_CATEGORIES } from "./event-rules";

export const REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "declined",
  "withdrawn",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_NOTICES = ["under_review", "approved", "declined"] as const;
export const REQUEST_TYPES = ["external", "proposal"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_SOURCES = ["leaflet", "invitation", "website", "other"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];
export const MAX_REQUEST_FILES = 3;
export const REQUEST_ORGANIZER_MAX = 120;
export const REQUEST_NOTES_MAX = 1000;
export const OPEN_REQUEST_LIMIT = 5;
export const REQUEST_TITLE_MAX = 120;
export const REQUEST_DESCRIPTION_MAX = 2000;
export const REQUEST_REASON_MAX = 1000;
export const DECLINE_REASON_MIN = 10;
/** Manager tabs: 'decided' = approved, declined or withdrawn. */
export const MANAGER_TABS = ["submitted", "under_review", "decided"] as const;
export type ManagerTab = (typeof MANAGER_TABS)[number];

const text = z.string().nullable();
/** One request as get_event_request / list_* return it (event_request_json). */
export const eventRequest = z.object({
  id: z.string().uuid(),
  request_type: z.enum(REQUEST_TYPES),
  organizer_name: z.string().nullable(),
  source: z.enum(REQUEST_SOURCES).nullable(),
  source_url: z.string().nullable(),
  notes: z.string().nullable(),
  category: z.string().nullable(),
  edited_by_manager: z.boolean(),
  last_edited_at: z.string().nullable(),
  last_edited_by_name: z.string().nullable(),
  attachment_count: z.number().int(),
  scope: z.enum(["branch", "region"]),
  branch_id: z.string().uuid().nullable(),
  region_id: z.string().uuid(),
  branch_name: text,
  region_name: text,
  title: z.string(),
  description: text,
  reason: text,
  all_day: z.boolean(),
  proposed_start: text,
  proposed_end: text,
  proposed_start_date: text,
  proposed_end_date: text,
  alt_start: text,
  alt_end: text,
  alt_start_date: text,
  alt_end_date: text,
  location_text: text,
  is_online: z.boolean(),
  online_url: text,
  expected_attendees: z.number().int().nullable(),
  status: z.enum(REQUEST_STATUSES),
  decline_reason: text,
  reviewed_at: text,
  created_at: z.string(),
  updated_at: z.string(),
  reviewer_name: text,
  requester_name: text,
  event_id: z.string().uuid().nullable(),
  notice: z.enum(REQUEST_NOTICES).nullable(),
  is_own: z.boolean(),
  can_edit: z.boolean(),
  can_withdraw: z.boolean(),
  can_review: z.boolean(),
  can_delete: z.boolean(),
});
export type EventRequest = z.infer<typeof eventRequest>;
export const managedRequests = z.object({ total: z.number().int(), rows: z.array(eventRequest) });
/** Counts only (dashboard card, menu badge). */
export const pendingRequestCount = z.object({
  submitted: z.number().int(),
  under_review: z.number().int(),
  total: z.number().int(),
});
export type PendingRequestCount = z.infer<typeof pendingRequestCount>;

/** RPC payload (submit_event_request / update_event_request); timed values are UTC instants. */
export const requestPayloadSchema = z.object({
  request_type: z.enum(REQUEST_TYPES),
  title: z.string().max(REQUEST_TITLE_MAX),
  description: z.string().max(REQUEST_DESCRIPTION_MAX),
  reason: z.string().max(REQUEST_REASON_MAX),
  all_day: z.boolean(),
  proposed_start: z.string().nullable(),
  proposed_end: z.string().nullable(),
  proposed_start_date: z.string().nullable(),
  proposed_end_date: z.string().nullable(),
  alt_start: z.string().nullable(),
  alt_end: z.string().nullable(),
  alt_start_date: z.string().nullable(),
  alt_end_date: z.string().nullable(),
  location_text: z.string().max(500),
  is_online: z.boolean(),
  online_url: z.string().max(2000).nullable(),
  expected_attendees: z.number().int().min(1).max(100000).nullable(),
  organizer_name: z.string().max(REQUEST_ORGANIZER_MAX).nullable(),
  source: z.enum(REQUEST_SOURCES).nullable(),
  source_url: z.string().max(2000).nullable(),
  notes: z.string().max(REQUEST_NOTES_MAX).nullable(),
  /** Reviewers only (manager_update_event_request); the requester's RPCs ignore it. */
  category: z.enum(EVENT_CATEGORIES).nullable(),
});
export type RequestPayload = z.infer<typeof requestPayloadSchema>;

/** Form state: timed values are London "YYYY-MM-DDTHH:mm", all-day values "YYYY-MM-DD". */
export type RequestFormFields = {
  type: RequestType;
  title: string;
  description: string;
  reason: string;
  allDay: boolean;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
  hasAlt: boolean;
  altStart: string;
  altEnd: string;
  altStartDate: string;
  altEndDate: string;
  isOnline: boolean;
  location: string;
  onlineUrl: string;
  expectedAttendees: string;
  organizer: string;
  source: RequestSource | "";
  sourceUrl: string;
  notes: string;
  category: string;
};
export const emptyRequestForm = (type: RequestType = "proposal"): RequestFormFields => ({
  type,
  title: "",
  description: "",
  reason: "",
  allDay: false,
  start: "",
  end: "",
  startDate: "",
  endDate: "",
  hasAlt: false,
  altStart: "",
  altEnd: "",
  altStartDate: "",
  altEndDate: "",
  isOnline: false,
  location: "",
  onlineUrl: "",
  expectedAttendees: "",
  organizer: "",
  source: "",
  sourceUrl: "",
  notes: "",
  category: "",
});
export function requestFormFromRow(r: EventRequest): RequestFormFields {
  const local = (v: string | null) => (v ? londonInput(v) : "");
  return {
    type: r.request_type,
    title: r.title,
    description: r.description ?? "",
    reason: r.reason ?? "",
    allDay: r.all_day,
    start: local(r.proposed_start),
    end: local(r.proposed_end),
    startDate: r.proposed_start_date ?? "",
    endDate:
      r.proposed_end_date && r.proposed_end_date !== r.proposed_start_date
        ? r.proposed_end_date
        : "",
    hasAlt: !!(r.alt_start || r.alt_start_date),
    altStart: local(r.alt_start),
    altEnd: local(r.alt_end),
    altStartDate: r.alt_start_date ?? "",
    altEndDate: r.alt_end_date ?? "",
    isOnline: r.is_online,
    location: r.location_text ?? "",
    onlineUrl: r.online_url ?? "",
    expectedAttendees: r.expected_attendees?.toString() ?? "",
    organizer: r.organizer_name ?? "",
    source: r.source ?? "",
    sourceUrl: r.source_url ?? "",
    notes: r.notes ?? "",
    category: r.category ?? "",
  };
}

const londonToday = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
function instant(value: string) {
  try {
    return Date.parse(londonToIso(value));
  } catch {
    return null;
  }
}
/**
 * Field errors (i18n keys) keyed by form field; the submit_event_request RPC enforces the same rules.
 * Proposed dates must be in the future (all-day: after today in London); end after start.
 */
export function validateRequestForm(f: RequestFormFields, now = new Date()) {
  const errors: Record<string, string> = {};
  if (!f.title.trim()) errors["title"] = "events.fieldRequired";
  else if (f.title.trim().length > REQUEST_TITLE_MAX) errors["title"] = "events.invalid";
  if (f.description.length > REQUEST_DESCRIPTION_MAX) errors["description"] = "events.invalid";
  if (f.reason.length > REQUEST_REASON_MAX) errors["reason"] = "events.invalid";
  if (f.location.length > 500) errors["location"] = "events.invalid";
  const today = londonToday(now);
  const pair = (prefix: "" | "alt-", required: boolean) => {
    if (f.allDay) {
      const start = prefix ? f.altStartDate : f.startDate,
        end = prefix ? f.altEndDate : f.endDate;
      if (!start) {
        if (required) errors[`${prefix}start-date`] = "events.fieldRequired";
        return;
      }
      if (start <= today) errors[`${prefix}start-date`] = "requests.errors.future";
      else if (end && end < start) errors[`${prefix}end-date`] = "events.dateError";
      return;
    }
    const start = prefix ? f.altStart : f.start,
      end = prefix ? f.altEnd : f.end;
    if (!start && !end && !required) return;
    const s = start ? instant(start) : null,
      e = end ? instant(end) : null;
    if (!start) errors[`${prefix}start`] = "events.fieldRequired";
    else if (s === null) errors[`${prefix}start`] = "events.timeError";
    else if (s <= now.getTime()) errors[`${prefix}start`] = "requests.errors.future";
    if (!end) errors[`${prefix}end`] = "events.fieldRequired";
    else if (e === null) errors[`${prefix}end`] = "events.timeError";
    else if (s !== null && e <= s) errors[`${prefix}end`] = "events.dateError";
  };
  pair("", true);
  // External requests: an organiser and where it was seen; no alternative date or attendee estimate.
  if (f.type === "external") {
    if (!f.organizer.trim()) errors["organizer"] = "events.fieldRequired";
    else if (f.organizer.trim().length > REQUEST_ORGANIZER_MAX)
      errors["organizer"] = "events.invalid";
    if (!f.source) errors["source"] = "events.fieldRequired";
    if (f.sourceUrl.trim() && !ONLINE_URL.test(f.sourceUrl.trim()))
      errors["source-url"] = "requests.errors.sourceUrl";
    if (f.notes.length > REQUEST_NOTES_MAX) errors["notes"] = "events.invalid";
  } else if (f.hasAlt) pair("alt-", false);
  if (f.isOnline && f.onlineUrl.trim() && !ONLINE_URL.test(f.onlineUrl.trim()))
    errors["online-url"] = "events.onlineUrlError";
  if (f.type === "proposal" && f.expectedAttendees) {
    const n = Number(f.expectedAttendees);
    if (!Number.isInteger(n) || n < 1 || n > 100000)
      errors["expected-attendees"] = "events.invalid";
  }
  return errors;
}

/** Builds the RPC payload from a validated form. */
export function requestPayload(f: RequestFormFields): RequestPayload {
  const iso = (v: string) => (v ? londonToIso(v) : null);
  const external = f.type === "external";
  const alt = f.hasAlt && !external;
  return {
    request_type: f.type,
    title: f.title.trim(),
    description: f.description.trim(),
    reason: external ? "" : f.reason.trim(),
    all_day: f.allDay,
    proposed_start: f.allDay ? null : iso(f.start),
    proposed_end: f.allDay ? null : iso(f.end),
    proposed_start_date: f.allDay ? f.startDate || null : null,
    proposed_end_date: f.allDay ? f.endDate || null : null,
    alt_start: !f.allDay && alt ? iso(f.altStart) : null,
    alt_end: !f.allDay && alt ? iso(f.altEnd) : null,
    alt_start_date: f.allDay && alt ? f.altStartDate || null : null,
    alt_end_date: f.allDay && alt ? f.altEndDate || null : null,
    location_text: f.location.trim(),
    is_online: f.isOnline,
    online_url: f.isOnline && f.onlineUrl.trim() ? f.onlineUrl.trim() : null,
    expected_attendees: !external && f.expectedAttendees ? Number(f.expectedAttendees) : null,
    organizer_name: external ? f.organizer.trim() : null,
    source: external && f.source ? f.source : null,
    source_url: external && f.sourceUrl.trim() ? f.sourceUrl.trim() : null,
    notes: external && f.notes.trim() ? f.notes.trim() : null,
    category: EVENT_CATEGORIES.find((c) => c === f.category) ?? null,
  };
}

/** Event-time shape of a request's proposed (or alternative) dates, for the shared date formatters. */
export function requestTime(r: EventRequest, alt = false) {
  return alt
    ? {
        all_day: r.all_day,
        start_at: r.alt_start,
        end_at: r.alt_end,
        start_date: r.alt_start_date,
        end_date: r.alt_end_date,
      }
    : {
        all_day: r.all_day,
        start_at: r.proposed_start,
        end_at: r.proposed_end,
        start_date: r.proposed_start_date,
        end_date: r.proposed_end_date,
      };
}
export const isOpenRequest = (status: RequestStatus) =>
  status === "submitted" || status === "under_review";

/** An attachment as list_event_request_media returns it, plus a 5-minute signed URL. */
export const requestMedia = z.object({
  id: z.string().uuid(),
  storage_path: z.string(),
  kind: z.enum(["image", "pdf"]),
  original_name: z.string().nullable(),
  uploaded: z.boolean(),
});
export type RequestMedia = z.infer<typeof requestMedia> & { url: string | null };
export const duplicateEvent = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  all_day: z.boolean(),
  start_at: z.string().nullable(),
  start_date: z.string().nullable(),
});
export type DuplicateEvent = z.infer<typeof duplicateEvent>;
/** Request attachments: images (re-encoded in the browser) and PDFs only. */
export const REQUEST_FILE_EXTENSIONS = ["jpg", "png", "webp", "pdf"] as const;
export const REQUEST_FILE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
