import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  linkedTask,
  mergeLinkedTasks,
  reminderSettings,
  person,
  task,
  taskDetail,
  taskInput,
  taskNote,
  taskSummary,
  taskGroup,
  taskGroupInput,
  TASK_NOTE_MAX,
  TASK_STATUSES,
  WORK_SCOPES,
} from "./tasks";
import { taskSources } from "./task-grouping";

/** Sends the notice emails an action just queued (assignments, invitations, requests waiting). */
const flushNoticeEmails = async () =>
  (await import("@/lib/notice-emails.server")).flushNoticeEmails();

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

/** Labels for the source groups of the Tasks page (agenda items, meetings, events of the visible tasks). */
export const listTaskSources = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("list_task_sources");
    fail(result.error);
    const sources = taskSources.parse(result.data ?? {});
    // The decision texts (the "Decision: …" line under a task): read through RLS (meeting_decisions_read), so only
    // decisions of meetings the caller may see. Without them the rows simply show no decision line.
    const ids = [...new Set(sources.decisions.map((d) => d.id))];
    if (!ids.length) return sources;
    const texts = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = await context.supabase
        .from("meeting_decisions")
        .select("id, text")
        .in("id", ids.slice(i, i + 200));
      if (chunk.error) return sources;
      for (const d of chunk.data ?? []) texts.set(d.id, d.text);
    }
    return {
      ...sources,
      decisions: sources.decisions.map((d) => ({ ...d, text: texts.get(d.id) ?? null })),
    };
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
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(taskId.extend({ task: taskInput }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_task", { p_id: data.id, p: data.task });
    fail(result.error);
    await flushNoticeEmails();
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

/**
 * Tasks linked to an event, for everyone who can see the event (each task only when visible). For a meeting's
 * calendar entry this also includes the tasks created from that meeting's decisions (tasks.meeting_id): both reads go
 * through RLS (meetings_read / tasks_read), so only the meeting and tasks the caller may see are found.
 */
export const getEventTasks = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const [result, meeting] = await Promise.all([
      context.supabase.rpc("get_event_tasks", { p_event: data.eventId }),
      context.supabase
        .from("meetings")
        .select("id")
        .eq("event_id", data.eventId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    fail(result.error);
    fail(meeting.error);
    const linked = z.array(linkedTask).parse(result.data ?? []);
    if (!meeting.data) return linked;
    const fromMeeting = await context.supabase
      .from("tasks")
      .select("id, title, status, due_date, archived_at, created_at, group_id")
      .eq("meeting_id", meeting.data.id)
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(500);
    fail(fromMeeting.error);
    return mergeLinkedTasks(linked, z.array(linkedTask).parse(fromMeeting.data ?? []));
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

// Task groups ("@all") ----------------------------------------------------------------------------------------

const groupId = z.object({ id: z.string().uuid() });
const uuidList = z.array(z.string().uuid()).max(500);

/** Every task group the caller can see (same visibility as branch tasks), with members, counts and derived status. */
export const listTaskGroups = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("list_task_groups");
    fail(result.error);
    return z.array(taskGroup).parse(result.data ?? []);
  });

export const getTaskGroup = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(groupId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_task_group", { p_id: data.id });
    fail(result.error);
    return result.data === null ? null : taskGroup.parse(result.data);
  });

/**
 * "@all": one group and one task per active member of the branch (the branch's managers only). The extra fields are
 * copied to every member task.
 */
export const createTaskGroup = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    taskGroupInput.extend({
      branch_id: z.string().uuid(),
      event_id: z.string().uuid().nullable().optional(),
      decision_id: z.string().uuid().nullable().optional(),
      reminders: reminderSettings.optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("create_task_group", {
      p: { ...data, scope: "branch" },
    });
    fail(result.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(result.data);
  });

/** Title, description, priority and due date go to every member task. */
export const updateTaskGroup = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(groupId.extend({ group: taskGroupInput }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_task_group", {
      p_id: data.id,
      p: data.group,
    });
    fail(result.error);
    await flushNoticeEmails();
    return { ok: true };
  });

/** Every member task goes to the Recycle Bin, then the group is removed. Returns how many tasks. */
export const deleteTaskGroup = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(groupId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_task_group", { p_id: data.id });
    fail(result.error);
    return { count: z.number().parse(result.data) };
  });

/** Adds members (their own task and notice) and removes members (their task to the Recycle Bin). */
export const setTaskGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(groupId.extend({ add: uuidList, remove: uuidList }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_task_group_members", {
      p_id: data.id,
      p_add: data.add,
      p_remove: data.remove,
    });
    fail(result.error);
    return z.object({ added: z.number(), removed: z.number() }).parse(result.data);
  });
