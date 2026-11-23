import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { meeting } from "./meetings";
import { notification } from "./notifications";
import { taskSummary } from "./tasks";

export const DASHBOARD_MEETINGS = 3;
export const DASHBOARD_NOTIFICATIONS = 10;

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
    return {
      tasks: part(tasks, taskSummary),
      meetings: part({ ...meetings, data: meetings.data ?? [] }, z.array(meeting)),
      notifications: part(
        { ...notifications, data: notifications.data ?? [] },
        z.array(notification),
      ),
    };
  });
