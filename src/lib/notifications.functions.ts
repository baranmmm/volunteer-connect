import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  NOTIFICATION_TYPES,
  notification,
  notificationCounts,
  notificationSettings,
  reviewWaiting,
} from "./notifications";

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

/** Page size of the Notifications page (each "Load more" fetches one more page). */
export const NOTIFICATIONS_PAGE_SIZE = 30;

/**
 * The Notifications page: the caller's own notices, read and unread, newest first, one page at a time. The cursor is
 * the last row of the previous page (its created_at and id).
 */
export const listMyNotificationsPage = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      before: z.string().datetime({ offset: true }).optional(),
      beforeId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_my_notifications_page", {
      ...(data.before ? { p_before: data.before } : {}),
      ...(data.beforeId ? { p_before_id: data.beforeId } : {}),
      p_limit: NOTIFICATIONS_PAGE_SIZE,
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
      entityType: z
        .enum(["task", "meeting", "task_request", "meeting_request", "review", "digest"])
        .optional(),
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

/** Profile > Notifications: every type with its setting (locked types are always on and immediate). */
export const getNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_notification_settings");
    fail(result.error);
    return notificationSettings.parse(result.data);
  });

/** In the app on/off for a changeable type (locked types are always on in the app). */
export const setNotificationSetting = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      type: z.enum(["task_status", "task_note", "task_reminder", "meeting", "request_decided", "media"]),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_notification_setting", {
      p_type: data.type,
      p_enabled: data.enabled,
      // Ignored by the database: email timing is no longer a personal choice.
      p_delivery: "immediate",
    });
    fail(result.error);
    return { ok: true };
  });

/** Email on/off for any type (the locked ones stay on in the app). */
export const setNotificationEmail = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ type: z.enum(NOTIFICATION_TYPES), on: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_notification_email", {
      p_type: data.type,
      p_on: data.on,
    });
    fail(result.error);
    return { ok: true };
  });

/** Requests waiting for the caller's decision: task/meeting requests, event requests and volunteer applications. */
export const getReviewWaiting = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_review_waiting");
    fail(result.error);
    return reviewWaiting.parse(result.data);
  });
