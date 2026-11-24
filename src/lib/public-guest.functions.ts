import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicEventSchema, type PublicEvent } from "@/lib/public-events";

// Signed-out forms and email links: no auth middleware on purpose. Every database call is a service-role-only RPC
// (guest_*, subscriber_*), reached only after the form guard (Turnstile / honeypot / fill time / rate limits) or with
// a signed email link. Answers never reveal whether an address is registered or subscribed.

const guard = {
  honeypot: z.string().max(200).optional(),
  startedAt: z.string().max(100),
  turnstileToken: z.string().max(4096).optional(),
};
const token = z.object({ token: z.string().min(1).max(100) });
const email = z.string().trim().max(254).email();

/** Turnstile site key (only when the secret is configured too) and a stamp for the minimum fill time. */
export const getPublicFormConfig = createServerFn({ method: "POST" }).handler(async () => {
  const { turnstileConfig, formStamp } = await import("@/lib/public-guest.server");
  return { turnstileSiteKey: turnstileConfig()?.siteKey ?? null, formStamp: await formStamp() };
});

async function flush(origin: string | null) {
  const { flushOutbox } = await import("@/lib/email/outbox.server");
  await flushOutbox({ maxPriority: 1, origin });
}

async function currentOrigin() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { requestOrigin } = await import("@/lib/public-guest.server");
  return requestOrigin(getRequest());
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export const registerGuest = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      eventId: z.string().uuid(),
      name: z.string().trim().min(1).max(120),
      email,
      phone: z.string().trim().max(40).optional(),
      places: z.number().int().min(1).max(10),
      keepInformed: z.boolean(),
      ...guard,
    }),
  )
  .handler(async ({ data }) => {
    const { guardPublicForm } = await import("@/lib/public-guest.server");
    const { verdict, origin } = await guardPublicForm("register", data);
    if (verdict === "drop") return { ok: true as const };
    const db = await admin();
    const { error } = await db.rpc("guest_register", {
      p_event: data.eventId,
      p_name: data.name,
      p_email: data.email,
      p_phone: data.phone ?? "",
      p_places: data.places,
      p_keep_informed: data.keepInformed,
    });
    if (error) throw new Error(error.message);
    await flush(origin);
    return { ok: true as const };
  });

export type GuestState =
  | "pending"
  | "registered"
  | "waitlisted"
  | "cancelled"
  | "attended"
  | "no_show"
  | "closed"
  | "started"
  | "invalid";
export type GuestView = {
  state: GuestState;
  position: number | null;
  places: number;
  event: PublicEvent | null;
  /** The online joining link: only on the manage (cancel-link) page, only while the guest holds a place. */
  onlineUrl?: string | null;
};

const viewSchema = z.object({
  status: z.enum(["pending", "registered", "waitlisted", "cancelled", "attended", "no_show"]),
  places: z.number().int(),
  waitlist_position: z.number().int().nullable().optional(),
  event: z.unknown().nullable(),
  online_url: z.string().url().startsWith("https://").nullable().optional(),
});

async function loadView(
  registrationId: string,
  state?: GuestState,
  withOnlineLink = false,
): Promise<GuestView> {
  const db = await admin();
  const { data, error } = await db.rpc("guest_registration_view", {
    p_registration: registrationId,
  });
  if (error) throw new Error("Public forms unavailable");
  const parsed = viewSchema.safeParse(data);
  if (!parsed.success) return { state: "invalid", position: null, places: 1, event: null };
  const event = publicEventSchema.safeParse(parsed.data.event);
  return {
    state: state ?? parsed.data.status,
    position: parsed.data.waitlist_position ?? null,
    places: parsed.data.places,
    event: event.success ? event.data : null,
    ...(withOnlineLink ? { onlineUrl: parsed.data.online_url ?? null } : {}),
  };
}

const INVALID: GuestView = { state: "invalid", position: null, places: 1, event: null };

/** The confirm / cancel pages: the registration's state and the event (no personal data). Read only. */
export const getGuestRegistration = createServerFn({ method: "POST" })
  .inputValidator(token.extend({ purpose: z.enum(["confirm", "cancel"]) }))
  .handler(async ({ data }): Promise<GuestView> => {
    const { verifyLinkToken } = await import("@/lib/email/links.server");
    const id = await verifyLinkToken(
      data.purpose === "confirm" ? "guest-confirm" : "guest-cancel",
      data.token,
    );
    if (!id) return INVALID;
    // The manage page (the cancel link from the guest's emails) shows the joining link of an online event.
    return loadView(id, undefined, data.purpose === "cancel");
  });

/** "Confirm my registration": takes the seat (or a waitlist place). Never on page load (mail scanners open links). */
export const confirmGuest = createServerFn({ method: "POST" })
  .inputValidator(token)
  .handler(async ({ data }): Promise<GuestView> => {
    const { verifyLinkToken } = await import("@/lib/email/links.server");
    const id = await verifyLinkToken("guest-confirm", data.token);
    if (!id) return INVALID;
    const db = await admin();
    const { error } = await db.rpc("guest_confirm", { p_registration: id });
    if (error) {
      if (error.message === "Link is no longer valid")
        return { ...(await loadView(id)), state: "invalid" };
      if (error.message === "Registration is closed") return loadView(id, "closed");
      throw new Error(error.message);
    }
    await flush(await currentOrigin());
    return loadView(id);
  });

/** "Cancel my registration" (a click on the cancel page; a freed seat goes to the waitlist). */
export const cancelGuest = createServerFn({ method: "POST" })
  .inputValidator(token)
  .handler(async ({ data }): Promise<GuestView> => {
    const { verifyLinkToken } = await import("@/lib/email/links.server");
    const id = await verifyLinkToken("guest-cancel", data.token);
    if (!id) return INVALID;
    const db = await admin();
    const { error } = await db.rpc("guest_cancel", { p_registration: id });
    if (error) {
      if (error.message === "Link is no longer valid") return INVALID;
      if (error.message === "Event has started") return loadView(id, "started");
      throw new Error(error.message);
    }
    await flush(await currentOrigin());
    return loadView(id);
  });

export const subscribe = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email,
      name: z.string().trim().max(120).optional(),
      branchId: z.string().uuid().optional(),
      source: z.enum(["landing", "event_registration"]),
      ...guard,
    }),
  )
  .handler(async ({ data }) => {
    const { guardPublicForm } = await import("@/lib/public-guest.server");
    const { verdict, origin } = await guardPublicForm("subscribe", data);
    if (verdict === "drop") return { ok: true as const };
    const db = await admin();
    const { error } = await db.rpc("subscriber_signup", {
      p_email: data.email,
      p_name: data.name ?? "",
      // NULL = interested in every branch.
      p_branch: (data.branchId ?? null) as string,
      p_source: data.source,
    });
    if (error) throw new Error(error.message);
    await flush(origin);
    return { ok: true as const };
  });

export type SubscriberState = "confirmed" | "unsubscribed" | "invalid";

export const confirmSubscriber = createServerFn({ method: "POST" })
  .inputValidator(token)
  .handler(async ({ data }): Promise<{ state: SubscriberState }> => {
    const { verifyLinkToken } = await import("@/lib/email/links.server");
    const id = await verifyLinkToken("subscriber-confirm", data.token);
    if (!id) return { state: "invalid" };
    const { data: result, error } = await (await admin()).rpc("subscriber_confirm", { p_id: id });
    if (error) {
      if (error.message === "Link is no longer valid") return { state: "invalid" };
      throw new Error(error.message);
    }
    const state = (result as { state?: string } | null)?.state;
    return { state: state === "unsubscribed" ? "unsubscribed" : "confirmed" };
  });

export const unsubscribe = createServerFn({ method: "POST" })
  .inputValidator(token)
  .handler(async ({ data }): Promise<{ state: SubscriberState }> => {
    const { unsubscribeWithToken } = await import("@/lib/public-guest.server");
    return { state: await unsubscribeWithToken(data.token) };
  });
