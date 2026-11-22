import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  eventRequest,
  managedRequests,
  pendingRequestCount,
  requestPayloadSchema,
  MANAGER_TABS,
} from "./event-requests";

// Every write is a SECURITY DEFINER RPC (no client write grants on event_requests); RLS scopes the reads.
const requestId = z.object({ id: z.string().uuid() });
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const submitEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestPayloadSchema)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("submit_event_request", { p: data });
    fail(result.error);
    return z.string().uuid().parse(result.data);
  });
export const updateEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId.extend({ request: requestPayloadSchema }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_event_request", {
      p_id: data.id,
      p: data.request,
    });
    fail(result.error);
    return { ok: true };
  });
export const withdrawEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("withdraw_event_request", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });
export const deleteEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_event_request", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });
export const startReviewEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("start_review_event_request", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });
/** Creates the draft event; returns its id so the reviewer can open its edit form. */
export const approveEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("approve_event_request", {
      p_id: data.id,
      p_overrides: {},
    });
    fail(result.error);
    return z.object({ event_id: z.string().uuid() }).parse(result.data).event_id;
  });
export const declineEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId.extend({ reason: z.string().max(1000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("decline_event_request", {
      p_id: data.id,
      p_reason: data.reason,
    });
    fail(result.error);
    return { ok: true };
  });
export const myEventRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("list_my_event_requests");
    fail(result.error);
    return z.array(eventRequest).parse(result.data);
  });
export const managedEventRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ tab: z.enum(MANAGER_TABS), offset: z.number().int().min(0).max(1000000) }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_managed_event_requests", {
      p_status: data.tab,
      p_offset: data.offset,
    });
    fail(result.error);
    return managedRequests.parse(result.data);
  });
export const getEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_request", { p_id: data.id });
    fail(result.error);
    return eventRequest.parse(result.data);
  });
export const pendingEventRequestCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_pending_event_request_count");
    fail(result.error);
    return pendingRequestCount.parse(result.data);
  });
export const dismissEventRequestNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("dismiss_event_request_notice", { p_id: data.id });
    fail(result.error);
    return { ok: true };
  });
