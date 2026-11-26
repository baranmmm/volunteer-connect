import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { meetingInput } from "./meetings";
import {
  meetingRequest,
  meetingRequestInput,
  requestTarget,
  taskRequest,
  taskRequestInput,
} from "./work-requests";

/** Sends the notice emails an action just queued (assignments, invitations, requests waiting). */
const flushNoticeEmails = async () =>
  (await import("@/lib/notice-emails.server")).flushNoticeEmails();

// Task and meeting requests. The database checks the chain (who may ask whom) and who may decide.
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const requestId = z.object({ id: z.string().uuid() });
const kind = z.enum(["task", "meeting"]);

export const listRequestTargets = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("list_request_targets");
    fail(result.error);
    return z.array(requestTarget).parse(result.data ?? []);
  });

export const submitTaskRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskRequestInput)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("submit_task_request", { p: data });
    fail(result.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });
export const submitMeetingRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(meetingRequestInput)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("submit_meeting_request", { p: data });
    fail(result.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });

/** The caller's own task and meeting requests, newest first. */
export const listMyWorkRequests = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const [tasks, meetings] = await Promise.all([
      context.supabase.rpc("list_my_task_requests"),
      context.supabase.rpc("list_my_meeting_requests"),
    ]);
    fail(tasks.error);
    fail(meetings.error);
    return [
      ...z.array(taskRequest).parse(tasks.data ?? []),
      ...z.array(meetingRequest).parse(meetings.data ?? []),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

/** Requests sent to the caller: open ones or decided ones. */
export const listWorkRequestsToReview = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ filter: z.enum(["open", "decided"]) }))
  .handler(async ({ data, context }) => {
    const [tasks, meetings] = await Promise.all([
      context.supabase.rpc("list_task_requests_to_review", { p_filter: data.filter }),
      context.supabase.rpc("list_meeting_requests_to_review", { p_filter: data.filter }),
    ]);
    fail(tasks.error);
    fail(meetings.error);
    return [
      ...z.array(taskRequest).parse(tasks.data ?? []),
      ...z.array(meetingRequest).parse(meetings.data ?? []),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

export const workRequestCount = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_work_request_count");
    fail(result.error);
    return z
      .number()
      .int()
      .parse(result.data ?? 0);
  });

export const withdrawWorkRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(requestId.extend({ kind }))
  .handler(async ({ data, context }) => {
    const result =
      data.kind === "task"
        ? await context.supabase.rpc("withdraw_task_request", { p_id: data.id })
        : await context.supabase.rpc("withdraw_meeting_request", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });

export const declineWorkRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(requestId.extend({ kind, reason: z.string().max(1000) }))
  .handler(async ({ data, context }) => {
    const result =
      data.kind === "task"
        ? await context.supabase.rpc("decline_task_request", {
            p_id: data.id,
            p_reason: data.reason,
          })
        : await context.supabase.rpc("decline_meeting_request", {
            p_id: data.id,
            p_reason: data.reason,
          });
    fail(result.error);
    return { ok: true };
  });

/** Accept a task request: a task assigned to the caller. Returns the task id. */
export const acceptTaskRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("accept_task_request", { p_id: data.id });
    fail(result.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });

/** Approve a meeting request with the meeting as edited before saving. Returns the meeting id. */
export const approveMeetingRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(requestId.extend({ meeting: meetingInput }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("approve_meeting_request", {
      p_id: data.id,
      p_meeting: data.meeting,
    });
    fail(result.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });
