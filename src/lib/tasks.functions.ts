import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  linkedTask,
  reminderSettings,
  person,
  task,
  taskDetail,
  taskInput,
  taskNote,
  taskSummary,
  TASK_NOTE_MAX,
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

/** Tasks linked to an event, for everyone who can see the event (each task only when visible). */
export const getEventTasks = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_tasks", { p_event: data.eventId });
    fail(result.error);
    return z.array(linkedTask).parse(result.data ?? []);
  });

// Archive ------------------------------------------------------------------------------------------------------

/** Archive (only done tasks) or unarchive one task: assignees and editors. */
export const archiveTask = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("archive_task", {
      p_id: data.id,
      p_archived: data.archived,
    });
    fail(result.error);
    return { archived: z.boolean().parse(result.data) };
  });
/** "Archive all done": the given done tasks the caller may change. Returns how many were archived. */
export const archiveDoneTasks = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ ids: z.array(z.string().uuid()).max(1000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("archive_done_tasks", { p_ids: data.ids });
    fail(result.error);
    return { archived: z.number().parse(result.data) };
  });

// Notes --------------------------------------------------------------------------------------------------------

const noteBody = z.string().trim().min(1).max(TASK_NOTE_MAX);
const mentionIds = z.array(z.string().uuid()).max(20);
export const listTaskNotes = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(taskId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_task_notes", { p_task: data.id });
    fail(result.error);
    return z.array(taskNote).parse(result.data ?? []);
  });
/** Assignees, the creator and the scope's managers. Mentioned people (who must see the task) get a notice. */
export const addTaskNote = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ body: noteBody, mentions: mentionIds }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_task_note", {
      p_task: data.id,
      p_body: data.body,
      p_mentions: data.mentions,
    });
    fail(result.error);
    return z.string().uuid().parse(result.data);
  });
/** The author only. Newly mentioned people get a notice. */
export const updateTaskNote = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ noteId: z.string().uuid(), body: noteBody, mentions: mentionIds }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_task_note", {
      p_id: data.noteId,
      p_body: data.body,
      p_mentions: data.mentions,
    });
    fail(result.error);
    return { ok: true };
  });
export const deleteTaskNote = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ noteId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_task_note", { p_id: data.noteId });
    fail(result.error);
    return { ok: true };
  });
/** People who can see the task (the @mention picker), without the caller. */
export const listTaskMentionPeople = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(taskId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_task_mention_people", { p_task: data.id });
    fail(result.error);
    return z.array(person).parse(result.data ?? []);
  });

/** An assignee's own reminders on a task assigned to them (null clears them). Only for them. */
export const setMyTaskReminders = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ reminders: reminderSettings.nullable() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_my_task_reminders", {
      p_id: data.id,
      p_reminders: data.reminders,
    });
    fail(result.error);
    return { reminders: reminderSettings.nullable().parse(result.data ?? null) };
  });
