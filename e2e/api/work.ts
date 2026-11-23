// Tasks and meetings for tests: create through the real RPCs as a user, and clean up with the service role.
// Everything a test creates on the shared QA database has a title starting with TASK_TITLE_PREFIX or
// MEETING_TITLE_PREFIX followed by the run id, and is removed by its own test (fixtures) or, if a run was interrupted,
// by the teardown sweep (this run's items, and any older than the stale limit). No test assumes a fixed list.
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, clientAs, clientAsAal2 } from "./SupabaseClient";

export const TASK_TITLE_PREFIX = "E2E Task ";
export const MEETING_TITLE_PREFIX = "E2E Meeting ";
export const MEETING_BUCKET = "meeting-files";

type Who = { email: string; totpSecret?: string };
const as = (who: Who): Promise<SupabaseClient> => (who.totpSecret ? clientAsAal2(who.email, who.totpSecret) : clientAs(who.email));

/** { data, error } of an RPC called as a user (never throws, so tests can assert refusals). */
export async function workRpc(who: Who, fn: string, args: Record<string, unknown> = {}) {
  return (await as(who)).rpc(fn, args);
}

export type TaskSpec = {
  scope: "branch" | "region" | "national";
  branch_id?: string | null;
  region_id?: string | null;
  title: string;
  description?: string;
  status?: "todo" | "in_progress" | "blocked" | "done";
  priority?: "low" | "medium" | "high" | "urgent";
  due_date?: string | null;
  assignee_ids?: string[];
  decision_id?: string;
  event_id?: string;
};
export async function createTaskAs(who: Who, spec: TaskSpec): Promise<string> {
  const { data, error } = await workRpc(who, "create_task", { p: spec });
  if (error) throw new Error(`create_task: ${error.message}`);
  return data as string;
}

export type MeetingSpec = {
  scope: "branch" | "region" | "national";
  branch_id?: string | null;
  region_id?: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location_type?: "in_person" | "online";
  location?: string;
  online_url?: string;
  invitee_ids?: string[];
};
export async function createMeetingAs(who: Who, spec: MeetingSpec): Promise<string> {
  const { data, error } = await workRpc(who, "create_meeting", {
    p: { location_type: "in_person", location: "E2E Hall", ...spec },
  });
  if (error) throw new Error(`create_meeting: ${error.message}`);
  return data as string;
}
/** An ISO instant `days` from now at a quarter hour (UTC). */
export function inDays(days: number, hours = 0) {
  const d = new Date(Date.now() + days * 86400000 + hours * 3600000);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
  return d.toISOString();
}

async function removeMeetingFiles(meetingIds: string[]) {
  const storage = adminClient().storage.from(MEETING_BUCKET);
  for (const id of meetingIds) {
    const { data } = await storage.list(id, { limit: 100 });
    const paths = (data ?? []).map((o) => `${id}/${o.name}`);
    if (paths.length) await storage.remove(paths);
  }
}

/** Deletes tasks and meetings (files first) by id, with the notices about them (seeded users keep no stale notices). */
export async function deleteWork(ids: { tasks?: string[]; meetings?: string[]; requests?: string[] }) {
  const db = adminClient();
  const all = [...(ids.tasks ?? []), ...(ids.meetings ?? []), ...(ids.requests ?? [])];
  for (let i = 0; i < all.length; i += 100) {
    const r = await db.from("notifications").delete().in("entity_id", all.slice(i, i + 100));
    if (r.error) throw new Error(`delete notices: ${r.error.message}`);
  }
  if (ids.tasks?.length) {
    const r = await db.from("tasks").delete().in("id", ids.tasks);
    if (r.error) throw new Error(`delete tasks: ${r.error.message}`);
  }
  if (ids.meetings?.length) {
    await removeMeetingFiles(ids.meetings);
    // Each meeting has a calendar entry (an event with category "meeting"): the meeting first, then its event.
    const linked = await db.from("meetings").select("event_id").in("id", ids.meetings);
    if (linked.error) throw new Error(`find meeting events: ${linked.error.message}`);
    const inSeries = await db.from("meetings").select("series_id").in("id", ids.meetings).not("series_id", "is", null);
    if (inSeries.error) throw new Error(`find meeting series: ${inSeries.error.message}`);
    const series = inSeries.data.map((m) => m.series_id as string);
    const r = await db.from("meetings").delete().in("id", ids.meetings);
    if (r.error) throw new Error(`delete meetings: ${r.error.message}`);
    const events = linked.data.map((m) => m.event_id as string).filter(Boolean);
    if (events.length) {
      const e = await db.from("events").delete().in("id", events).eq("category", "meeting");
      if (e.error) throw new Error(`delete meeting events: ${e.error.message}`);
    }
    await deleteEmptyMeetingSeries(series);
  }
}

/** Series rows of recurring meetings once none of their occurrences is left. */
async function deleteEmptyMeetingSeries(seriesIds: string[]) {
  const db = adminClient();
  for (const id of new Set(seriesIds)) {
    const left = await db.from("meetings").select("id", { count: "exact", head: true }).eq("series_id", id);
    if (left.error) throw new Error(`find series meetings: ${left.error.message}`);
    if (left.count) continue;
    const r = await db.from("meeting_series").delete().eq("id", id);
    if (r.error) throw new Error(`delete meeting series: ${r.error.message}`);
  }
}

/**
 * Tasks, meetings and task/meeting requests of these users (creator, requester or target), before the users are
 * deleted (which would only null those references and leave the rows on QA).
 */
export async function deleteWorkOfUsers(userIds: string[]): Promise<number> {
  if (!userIds.length) return 0;
  const db = adminClient();
  let n = 0;
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    // One request per table (requester or target), so every freshUser cleanup stays cheap on the shared QA project.
    const people = `(${batch.join(",")})`;
    for (const table of ["task_requests", "meeting_requests"] as const) {
      const r = await db.from(table).delete().or(`requester_id.in.${people},target_id.in.${people}`).select("id");
      if (r.error) throw new Error(`delete ${table}: ${r.error.message}`);
      n += r.data.length;
      await deleteWork({ requests: r.data.map((row) => row.id as string) });
    }
    const tasks = await db.from("tasks").select("id").in("created_by", batch);
    const meetings = await db.from("meetings").select("id").in("created_by", batch);
    if (tasks.error || meetings.error) throw new Error(`find work: ${(tasks.error ?? meetings.error)!.message}`);
    await deleteWork({ tasks: tasks.data.map((t) => t.id), meetings: meetings.data.map((m) => m.id) });
    n += tasks.data.length + meetings.data.length;
  }
  return n;
}

/** Leftovers of interrupted runs: this run's prefixed items, and any prefixed item older than `staleBefore`. */
export async function deleteLeftoverWork(staleBefore: number, runId?: string): Promise<number> {
  const db = adminClient();
  const stale = new Date(staleBefore).toISOString();
  let n = 0;
  const pick = async (table: "tasks" | "meetings" | "task_requests" | "meeting_requests", column: "title" | "topic", prefix: string) => {
    const old = await db.from(table).select("id").like(column, `${prefix}%`).lt("created_at", stale);
    const own = runId ? await db.from(table).select("id").like(column, `${prefix}${runId}%`) : { data: [], error: null };
    if (old.error || own.error) throw new Error(`find leftover ${table}: ${(old.error ?? own.error)!.message}`);
    return [...new Set([...(old.data ?? []), ...(own.data ?? [])].map((r) => r.id as string))];
  };
  for (const [table, column, prefix] of [
    ["task_requests", "title", TASK_TITLE_PREFIX],
    ["meeting_requests", "topic", MEETING_TITLE_PREFIX],
  ] as const) {
    const ids = await pick(table, column, prefix);
    if (ids.length) {
      const r = await db.from(table).delete().in("id", ids);
      if (r.error) throw new Error(`delete leftover ${table}: ${r.error.message}`);
      await deleteWork({ requests: ids });
    }
    n += ids.length;
  }
  const tasks = await pick("tasks", "title", TASK_TITLE_PREFIX);
  const meetings = await pick("meetings", "title", MEETING_TITLE_PREFIX);
  await deleteWork({ tasks, meetings });
  return n + tasks.length + meetings.length;
}

/** A recurring meeting (create_meeting with recurrence and agenda titles); returns the first occurrence's id. */
export async function createMeetingSeriesAs(
  who: Who,
  spec: MeetingSpec & { recurrence: { freq: "weekly" | "monthly"; interval: number; count: number }; agenda?: string[] },
): Promise<string> {
  return createMeetingAs(who, spec as MeetingSpec);
}
/** The occurrences of a recurring meeting (service role), in order: id, position, start, calendar entry, status. */
export async function meetingOccurrences(firstId: string) {
  const db = adminClient();
  const first = await db.from("meetings").select("series_id").eq("id", firstId).single();
  if (first.error) throw new Error(`find series: ${first.error.message}`);
  const rows = await db
    .from("meetings")
    .select("id, series_position, starts_at, event_id, status, title")
    .eq("series_id", first.data.series_id as string)
    .is("deleted_at", null)
    .order("starts_at");
  if (rows.error) throw new Error(`list occurrences: ${rows.error.message}`);
  return rows.data as { id: string; series_position: number; starts_at: string; event_id: string; status: string; title: string }[];
}
