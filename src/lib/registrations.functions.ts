import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  registrationResult,
  registrationSummary,
  type ManagerRegistration,
  type MyRegistration,
} from "./registrations";

// Every write is a SECURITY DEFINER RPC (no client write grants on event_registrations); RLS scopes the reads.
const eventId = z.object({ eventId: z.string().uuid() });
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
/** Sends the confirmation / cancellation email the RPC queued (public events). Never fails the user's action. */
async function sendQueuedEmails() {
  try {
    const { flushOutbox, requestOrigin } = await import("@/lib/email/outbox.server");
    await flushOutbox({ maxPriority: 1, origin: await requestOrigin() });
  } catch {
    /* rows stay queued for the scheduled sender */
  }
}

export const getRegistrationSummary = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_registration_summary", {
      p_event_id: data.eventId,
    });
    fail(result.error);
    return registrationSummary.parse(result.data);
  });
export const registerForEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId.extend({ showName: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    // Without showName the database default applies: names are shown unless the volunteer hides them.
    const result = await context.supabase.rpc("register_for_event", {
      p_event_id: data.eventId,
      ...(data.showName === undefined ? {} : { p_show_name: data.showName }),
    });
    fail(result.error);
    await sendQueuedEmails();
    return registrationResult.parse(result.data);
  });
export const cancelRegistration = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("cancel_registration", { p_event_id: data.eventId });
    fail(result.error);
    // Also a promoted waitlisted attendee's email.
    await sendQueuedEmails();
    return registrationResult.parse(result.data);
  });
export const setRegistrationShowName = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId.extend({ showName: z.boolean() }))
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("set_registration_show_name", {
          p_event_id: data.eventId,
          p_show_name: data.showName,
        })
      ).error,
    );
  });
/** Managers only (the RPC checks can_manage_event_scope). */
export const listRegistrations = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_registrations", {
      p_event_id: data.eventId,
    });
    fail(result.error);
    return (result.data ?? []) as ManagerRegistration[];
  });
export const markAttendance = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ registrationId: z.string().uuid(), status: z.enum(["attended", "no_show"]) }),
  )
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("mark_attendance", {
          p_registration_id: data.registrationId,
          p_status: data.status,
        })
      ).error,
    );
  });
export const myRegistrations = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_my_registrations");
    fail(result.error);
    return (result.data ?? []) as MyRegistration[];
  });
export const dismissRegistrationNotice = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ registrationId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("dismiss_registration_notice", {
          p_registration_id: data.registrationId,
        })
      ).error,
    );
  });
