import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  duplicateEvent,
  requestMedia,
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
/**
 * Proposals become a draft, external requests are published. Attachments are copied to the event's media with the
 * reviewer's own token: Storage RLS allows reading the request file and writing the reserved event path. A copy that
 * fails leaves no broken media row behind (delete_event_media); the count of such files is returned.
 */
export const approveEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("approve_event_request", { p_id: data.id });
    fail(result.error);
    const approved = z
      .object({
        event_id: z.string().uuid(),
        published: z.boolean(),
        copies: z.array(
          z.object({ media_id: z.string().uuid(), from: z.string(), to: z.string() }),
        ),
      })
      .parse(result.data);
    let failedCopies = 0;
    for (const copy of approved.copies) {
      const file = await context.supabase.storage.from("event-request-files").download(copy.from);
      const uploaded = file.error
        ? file
        : await context.supabase.storage
            .from("event-media")
            .upload(copy.to, file.data, { contentType: file.data.type, upsert: false });
      if (uploaded.error) {
        failedCopies++;
        await context.supabase.rpc("delete_event_media", { _media: copy.media_id });
      }
    }
    return { eventId: approved.event_id, published: approved.published, failedCopies };
  });
/** Reviewers edit an open request before deciding (the single editing path; no approval overrides). */
export const managerUpdateEventRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId.extend({ request: requestPayloadSchema }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("manager_update_event_request", {
      p_id: data.id,
      p: data.request,
    });
    fail(result.error);
    return { ok: true };
  });
export const eventRequestDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_request_duplicates", { p_id: data.id });
    fail(result.error);
    return z.array(duplicateEvent).parse(result.data);
  });
/** Attachments with 5-minute signed URLs (Storage RLS: the requester and the request's reviewers only). */
export const listRequestMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(requestId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_event_request_media", {
      p_request_id: data.id,
    });
    fail(result.error);
    const rows = z.array(requestMedia).parse(result.data);
    const stored = rows.filter((r) => r.uploaded);
    const signed = stored.length
      ? await context.supabase.storage.from("event-request-files").createSignedUrls(
          stored.map((r) => r.storage_path),
          300,
        )
      : { data: [], error: null };
    if (signed.error) throw new Error("Request files could not be loaded");
    return rows.map((r) => {
      const raw = signed.data?.find((u) => u.path === r.storage_path)?.signedUrl;
      // Browser-facing URLs stay on the browser's Supabase origin (same as event media).
      const url = raw
        ? `${import.meta.env["VITE_SUPABASE_URL"]}${new URL(raw).pathname}${new URL(raw).search}`
        : null;
      return { ...r, url };
    });
  });
export const reserveRequestMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    requestId.extend({
      kind: z.enum(["image", "pdf"]),
      extension: z.enum(["jpg", "jpeg", "png", "webp", "pdf"]),
      originalName: z.string().max(255),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("add_event_request_media", {
      p_request_id: data.id,
      p_kind: data.kind,
      p_extension: data.extension,
      p_original_name: data.originalName,
    });
    fail(result.error);
    return z
      .object({ id: z.string().uuid(), storage_path: z.string(), kind: z.enum(["image", "pdf"]) })
      .parse(result.data);
  });
/** Call after the stored file was removed through Storage (the RPC refuses otherwise). */
export const deleteRequestMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ mediaId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("delete_event_request_media", {
      p_media_id: data.mediaId,
    });
    fail(result.error);
    return { ok: true };
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
