import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { meeting } from "./meetings";
import { notification } from "./notifications";
import { taskDetail, taskSummary, type TaskSummary } from "./tasks";

export const DASHBOARD_MEETINGS = 3;
export const DASHBOARD_NOTIFICATIONS = 30;

/** One part of the dashboard: its data, or null when that RPC failed (the card shows its own error and retry). */
function part<T>(
  result: { data: unknown; error: { message: string } | null },
  schema: z.ZodType<T>,
): T | null {
  if (result.error) return null;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

/**
 * The three dashboard work cards (My tasks, Upcoming meetings, Notifications) in one call: one sign-in and privacy
 * check instead of three, so every dashboard visit costs the database a third of the requests. The RPCs and their
 * permission checks are the same ones the separate functions call.
 */
export const getDashboardWork = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const [tasks, meetings, notifications] = await Promise.all([
      context.supabase.rpc("get_my_task_summary"),
      context.supabase.rpc("list_meetings", { p_when: "upcoming", p_limit: DASHBOARD_MEETINGS }),
      context.supabase.rpc("list_my_notifications", { p_limit: DASHBOARD_NOTIFICATIONS }),
    ]);
    const summary = part(tasks, taskSummary);
    return {
      tasks: summary ? await withAssignees(context, summary) : null,
      meetings: part({ ...meetings, data: meetings.data ?? [] }, z.array(meeting)),
      notifications: part(
        { ...notifications, data: notifications.data ?? [] },
        z.array(notification),
      ),
    };
  });

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

/**
 * The assignees of the card's tasks (shown as "You" or "You +1"): one RLS read of task_assignees, and the names only
 * for the few tasks shared with someone else (get_task). Any failure leaves the assignees out (the card then shows
 * "You": every task on it is assigned to the caller).
 */
async function withAssignees(context: Ctx, summary: TaskSummary): Promise<TaskSummary> {
  const shown = summary.next.slice(0, 5);
  if (!shown.length) return summary;
  try {
    const rows = await context.supabase
      .from("task_assignees")
      .select("task_id, user_id")
      .in(
        "task_id",
        shown.map((x) => x.id),
      );
    if (rows.error) return summary;
    const parsed = z
      .array(z.object({ task_id: z.string().uuid(), user_id: z.string().uuid() }))
      .parse(rows.data ?? []);
    const shared = shown.filter((x) =>
      parsed.some((r) => r.task_id === x.id && r.user_id !== context.userId),
    );
    const details = await Promise.all(
      shared.map(async (x) => {
        const r = await context.supabase.rpc("get_task", { p_id: x.id });
        const d = r.error ? null : taskDetail.safeParse(r.data);
        return [x.id, d?.success ? d.data.assignees : null] as const;
      }),
    );
    const named = new Map(details);
    return {
      ...summary,
      next: summary.next.map((x) => {
        const people = named.get(x.id);
        if (people)
          return { ...x, assignees: people.map((p) => ({ id: p.id, full_name: p.full_name })) };
        if (shown.some((s) => s.id === x.id))
          return { ...x, assignees: [{ id: context.userId, full_name: null }] };
        return x;
      }),
    };
  } catch {
    return summary;
  }
}
