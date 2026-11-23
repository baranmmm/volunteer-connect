import { z } from "zod";
import { TASK_PRIORITIES } from "./tasks";

// Task and meeting requests: a lower role asks a higher role in their chain (volunteer → their Branch Manager or
// Regional Director, Branch Manager → their Regional Director, Regional Director → a National Coordinator).

export const DECLINE_NOTE_MIN = 10;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = {
  id: z.string().uuid(),
  status: z.string(),
  decline_reason: z.string().nullable(),
  scope: z.enum(["branch", "national"]),
  branch: z.string().nullable(),
  requester_id: z.string().uuid().nullable(),
  requester_name: z.string().nullable(),
  target_id: z.string().uuid().nullable(),
  target_name: z.string().nullable(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
};
export const taskRequest = z.object({
  ...base,
  kind: z.literal("task"),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
  due_date: isoDate.nullable(),
  status: z.enum(["submitted", "accepted", "declined", "withdrawn"]),
  task_id: z.string().uuid().nullable(),
});
export const proposedTime = z.object({ starts_at: z.string(), ends_at: z.string() });
export const meetingRequest = z.object({
  ...base,
  kind: z.literal("meeting"),
  topic: z.string(),
  note: z.string().nullable(),
  proposed_times: z.array(proposedTime),
  status: z.enum(["submitted", "approved", "declined", "withdrawn"]),
  meeting_id: z.string().uuid().nullable(),
});
export type TaskRequest = z.infer<typeof taskRequest>;
export type MeetingRequest = z.infer<typeof meetingRequest>;
export type WorkRequest = TaskRequest | MeetingRequest;

export const requestTarget = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  role: z.enum(["branch_manager", "regional_director", "national_coordinator"]),
});
export type RequestTarget = z.infer<typeof requestTarget>;

export const taskRequestInput = z.object({
  target_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES),
  due_date: isoDate.nullable().optional(),
});
export const meetingRequestInput = z.object({
  target_id: z.string().uuid(),
  topic: z.string().trim().min(1).max(200),
  note: z.string().max(2000).nullable().optional(),
  proposed_times: z
    .array(
      z.object({
        starts_at: z.string().datetime({ offset: true }),
        ends_at: z.string().datetime({ offset: true }),
      }),
    )
    .max(3),
});

/** "open" (waiting for a decision) or "decided" — the same filter as the other request lists. */
export function isOpenWorkRequest(r: WorkRequest) {
  return r.status === "submitted";
}
export function workRequestTitle(r: WorkRequest) {
  return r.kind === "task" ? r.title : r.topic;
}
