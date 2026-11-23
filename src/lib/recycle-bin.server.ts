import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { eventDeletionResult } from "./event-deletion";
import type { RecycleType } from "./recycle-bin";

/** Only call after the user-scoped prepare RPC, or from the secret-authenticated scheduler. */
export async function purgeRecycleItem(
  client: SupabaseClient<Database>,
  type: Exclude<RecycleType, "series" | "event_request">,
  id: string,
) {
  if (type === "user") {
    const prepared = await client.rpc("prepare_user_purge", { _id: id });
    if (prepared.error) throw new Error(prepared.error.message);
    if (eventDeletionResult.parse(prepared.data).deleted) return { events: 0, users: 0, files: 0 };
    const removed = await client.auth.admin.deleteUser(id);
    if (removed.error && removed.error.code !== "user_not_found")
      throw new Error("Account erasure failed");
    const finished = await client.rpc("finish_user_recycle_operation", {
      _id: id,
      _operation: "purge",
    });
    if (finished.error) throw new Error(finished.error.message);
    return { events: 0, users: 1, files: 0 };
  }
  const prepared = await client.rpc("purge_event", { _event: id });
  if (prepared.error) throw new Error(prepared.error.message);
  const result = eventDeletionResult.parse(prepared.data);
  if (result.deleted) return { events: 0, users: 0, files: 0 };
  for (let offset = 0; offset < result.paths.length; offset += 100) {
    const removed = await client.storage
      .from("event-media")
      .remove(result.paths.slice(offset, offset + 100));
    if (removed.error) throw new Error("Event deletion cleanup failed");
  }
  const finished = await client.rpc("purge_event", { _event: id, _finalize: true });
  if (finished.error || !eventDeletionResult.parse(finished.data).deleted)
    throw new Error("Event deletion cleanup failed");
  return { events: 1, users: 0, files: result.paths.length };
}
/**
 * Event requests: Storage first, then the row. purge_event_request (service role) lists the stored attachments of a
 * request whose purge was requested (or which is past its 30 days), and with _finalize deletes the row only once
 * no file is stored any more.
 */
export async function purgeEventRequest(client: SupabaseClient<Database>, id: string) {
  const prepared = await client.rpc("purge_event_request", { _id: id });
  if (prepared.error) throw new Error(prepared.error.message);
  const result = eventDeletionResult.parse(prepared.data);
  if (result.deleted) return { requests: 0, files: 0 };
  for (let offset = 0; offset < result.paths.length; offset += 100) {
    const removed = await client.storage
      .from("event-request-files")
      .remove(result.paths.slice(offset, offset + 100));
    if (removed.error) throw new Error("Event deletion cleanup failed");
  }
  const finished = await client.rpc("purge_event_request", { _id: id, _finalize: true });
  if (finished.error || !eventDeletionResult.parse(finished.data).deleted)
    throw new Error("Event deletion cleanup failed");
  return { requests: 1, files: result.paths.length };
}

/**
 * Meetings: Storage first, then the row. purge_meeting (service role) lists the stored files of a deleted meeting whose
 * purge was requested (or which is past its 30 days), and with _finalize deletes the row only once no file is left.
 */
export async function purgeMeeting(client: SupabaseClient<Database>, id: string) {
  const prepared = await client.rpc("purge_meeting", { _id: id });
  if (prepared.error) throw new Error(prepared.error.message);
  const result = eventDeletionResult.parse(prepared.data);
  if (result.deleted) return { meetings: 0, files: 0 };
  for (let offset = 0; offset < result.paths.length; offset += 100) {
    const removed = await client.storage
      .from("meeting-files")
      .remove(result.paths.slice(offset, offset + 100));
    if (removed.error) throw new Error("Meeting deletion cleanup failed");
  }
  const finished = await client.rpc("purge_meeting", { _id: id, _finalize: true });
  if (finished.error || !eventDeletionResult.parse(finished.data).deleted)
    throw new Error("Meeting deletion cleanup failed");
  return { meetings: 1, files: result.paths.length };
}
