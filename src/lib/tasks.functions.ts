import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  linkedTask,
  person,
  task,
  taskDetail,
  taskInput,
  taskSummary,
  TASK_STATUSES,
  WORK_SCOPES,
} from "./tasks";

// Every write is a SECURITY DEFINER RPC (no client write grants on tasks); the database checks every permission.
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const taskId = z.object({ id: z.string().uuid() });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("list_tasks");
    fail(result.error);
    return z.array(task).parse(result.data ?? []);
  });

export const getTask = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(taskId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_task", { p_id: data.id });
    fail(result.error);
    return result.data === null ? null : taskDetail.parse(result.data);
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskInput.extend({ scope: z.enum(WORK_SCOPES) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("create_task", { p: data });
    fail(result.error);
    return z.string().uuid().parse(result.data);
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ task: taskInput }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_task", { p_id: data.id, p: data.task });
    fail(result.error);
    return { ok: true };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ status: z.enum(TASK_STATUSES) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_task_status", {
      p_id: data.id,
      p_status: data.status,
    });
    fail(result.error);
    return { ok: true };
  });

export const setTaskReminderMute = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ muted: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_task_reminder_mute", {
      p_id: data.id,
      p_muted: data.muted,
    });
    fail(result.error);
    return { muted: data.muted };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_task", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });

/** People the caller may assign in a scope (empty when they cannot create tasks there). */
export const listTaskPeople = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      scope: z.enum(WORK_SCOPES),
      branchId: z.string().uuid().nullable(),
      regionId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_task_people", {
      p_scope: data.scope,
      ...(data.branchId ? { p_branch: data.branchId } : {}),
      ...(data.regionId ? { p_region: data.regionId } : {}),
    });
    fail(result.error);
    return z.array(person).parse(result.data ?? []);
  });

export const getMyTaskSummary = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_my_task_summary");
    fail(result.error);
    return taskSummary.parse(result.data);
  });

/** Tasks linked to an event (only its managers get any). */
export const getEventTasks = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_tasks", { p_event: data.eventId });
    fail(result.error);
    return z.array(linkedTask).parse(result.data ?? []);
  });
