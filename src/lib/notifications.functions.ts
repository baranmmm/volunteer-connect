import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { notification, notificationCounts } from "./notifications";

// In-app notices (the caller's own only; RLS and the RPCs check it).
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ limit: z.number().int().min(1).max(100).optional() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_my_notifications", {
      p_limit: data.limit ?? 30,
    });
    fail(result.error);
    return z.array(notification).parse(result.data ?? []);
  });

export const getNotificationCounts = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_unread_notification_counts");
    fail(result.error);
    return notificationCounts.parse(result.data);
  });

/** Marks one notice, or every notice about one item ("opening the item"), or all as read. */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      id: z.string().uuid().optional(),
      entityType: z.enum(["task", "meeting", "task_request", "meeting_request"]).optional(),
      entityId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("mark_notifications_read", {
      ...(data.id ? { p_id: data.id } : {}),
      ...(data.entityType ? { p_entity_type: data.entityType } : {}),
      ...(data.entityId ? { p_entity_id: data.entityId } : {}),
    });
    fail(result.error);
    return {
      marked: z
        .number()
        .int()
        .parse(result.data ?? 0),
    };
  });

export const getNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_notification_preferences");
    fail(result.error);
    return z.object({ task_reminder_emails: z.boolean() }).parse(result.data);
  });

export const setTaskReminderEmails = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ on: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_task_reminder_emails", { p_on: data.on });
    fail(result.error);
    return { task_reminder_emails: data.on };
  });
