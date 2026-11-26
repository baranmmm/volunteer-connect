import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { base64urlDecode } from "@/lib/push/base64url";
import { NOTIFICATION_TYPES } from "@/lib/notifications";

// Web Push devices of the signed-in member (own rows only: the RPCs scope everything to auth.uid()) and the per-type
// push switch. The database checks every call (register_push_subscription, unregister_push_subscription,
// list_my_push_subscriptions, set_notification_push).
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

/** base64url without padding, decoding to exactly `bytes` bytes (and, for a public key, an uncompressed point). */
const key = (bytes: number) =>
  z
    .string()
    .max(200)
    .transform((s) => s.trim().replace(/=+$/, ""))
    .refine((s) => {
      try {
        const raw = base64urlDecode(s);
        return /^[A-Za-z0-9_-]+$/.test(s) && raw.length === bytes && (bytes !== 65 || raw[0] === 4);
      } catch {
        return false;
      }
    }, "Invalid push subscription");

const endpoint = z.string().url().max(2048).startsWith("https://");

export const registerPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      endpoint,
      p256dh: key(65),
      auth: key(16),
      label: z.string().max(60).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("register_push_subscription", {
      p_endpoint: data.endpoint,
      p_p256dh: data.p256dh,
      p_auth: data.auth,
      ...(data.label ? { p_user_agent: data.label } : {}),
    });
    fail(result.error);
    return { ok: true };
  });

/** This device (by endpoint) or another of my devices (by id). */
export const unregisterPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z
      .object({ endpoint: endpoint.optional(), id: z.string().uuid().optional() })
      .refine((d) => !!d.endpoint || !!d.id),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("unregister_push_subscription", {
      ...(data.endpoint ? { p_endpoint: data.endpoint } : {}),
      ...(data.id ? { p_id: data.id } : {}),
    });
    fail(result.error);
    return { removed: result.data === true };
  });

export const pushDevice = z.object({
  id: z.string().uuid(),
  user_agent: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  current: z.boolean(),
});
export type PushDevice = z.infer<typeof pushDevice>;

/** My devices with push on (labels and dates only); `current` marks this browser's endpoint when given. */
export const listMyPushSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ endpoint: endpoint.optional() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_my_push_subscriptions", {
      ...(data.endpoint ? { p_endpoint: data.endpoint } : {}),
    });
    fail(result.error);
    return z.array(pushDevice).parse(result.data ?? []);
  });

/** Push on/off for any notice type (the locked ones stay on in the app). */
export const setNotificationPush = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ type: z.enum(NOTIFICATION_TYPES), on: z.boolean() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("set_notification_push", {
      p_type: data.type,
      p_on: data.on,
    });
    fail(result.error);
    return { ok: true };
  });
