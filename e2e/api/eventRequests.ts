// A3 event requests through the app's RPCs with each user's own token; reads for assertions use the service
// role. Requests of fresh users are removed by the freshUser fixture and by teardown; titles start with
// REQUEST_TITLE_PREFIX so leftovers of interrupted runs (and drafts created by approving them) can be found.
import { adminClient, clientAs } from "./SupabaseClient";

export const REQUEST_TITLE_PREFIX = "E2E Request ";
export const TEMP_BRANCH_PREFIX = "E2E Temp Branch ";
export type RequestStatus = "submitted" | "under_review" | "approved" | "declined" | "withdrawn";
export type RequestRow = {
  id: string; requester_id: string | null; reviewer_id: string | null; scope: "branch" | "region"; branch_id: string | null; region_id: string;
  title: string; status: RequestStatus; event_id: string | null; notice: string | null; deleted_at: string | null; decline_reason: string | null;
};

/** A valid timed request `days` from now (2 hours long), merged with `extra`. */
export function requestInput(title: string, extra: Record<string, unknown> = {}, days = 7) {
  const start = new Date(Date.now() + days * 86400000);
  start.setUTCMinutes(0, 0, 0);
  return {
    title, description: "Requested by an E2E test", reason: "Community outreach", all_day: false,
    proposed_start: start.toISOString(), proposed_end: new Date(start.getTime() + 2 * 3600000).toISOString(),
    location_text: "E2E Community Hall", is_online: false, expected_attendees: 25, ...extra,
  };
}

/** Calls an RPC as `email`; returns `{ data, error }` (error message or null) without throwing. */
export async function rpcAs<T = unknown>(email: string, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (await clientAs(email)).rpc(fn, args);
  return { data: data as T, error: error?.message ?? null };
}
/** Submits a request as `email` and returns its id (throws on error). */
export async function submitRequestAs(email: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await rpcAs<string>(email, "submit_event_request", { p: requestInput(title, extra) });
  if (error) throw new Error(`submit_event_request: ${error}`);
  return data;
}

/** Service-role read of one request row. */
export async function requestRow(id: string): Promise<RequestRow | null> {
  const { data, error } = await adminClient().from("event_requests")
    .select("id, requester_id, reviewer_id, scope, branch_id, region_id, title, status, event_id, notice, deleted_at, decline_reason").eq("id", id).maybeSingle();
  if (error) throw new Error(`read request: ${error.message}`);
  return data as RequestRow | null;
}

/** Id of the (unique, test-generated) request title; polls briefly because the UI submit may still be landing. */
export async function requestIdByTitle(title: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await adminClient().from("event_requests").select("id").eq("title", title);
    if (error) throw new Error(`find request: ${error.message}`);
    if (data.length === 1) return (data[0] as { id: string }).id;
    if (data.length > 1) throw new Error(`more than one request titled ${title}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no request titled ${title}`);
}

/** Removes requests (and the drafts created by approving them). */
export async function deleteRequests(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data } = await adminClient().from("event_requests").select("event_id").in("id", ids);
  const events = (data ?? []).flatMap((r: { event_id: string | null }) => (r.event_id ? [r.event_id] : []));
  const removed = await adminClient().from("event_requests").delete().in("id", ids);
  if (removed.error) throw new Error(`delete requests: ${removed.error.message}`);
  if (events.length) await adminClient().from("events").delete().in("id", events);
}

/** Requests (and their drafts) of the given users, as requester or reviewer. Call before deleting the users. */
export async function deleteRequestsOfUsers(userIds: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    for (const column of ["requester_id", "reviewer_id"] as const) {
      const { data, error } = await adminClient().from("event_requests").select("id").in(column, batch);
      if (error) throw new Error(`find requests: ${error.message}`);
      await deleteRequests((data ?? []).map((r: { id: string }) => r.id));
      deleted += data?.length ?? 0;
    }
  }
  return deleted;
}

/**
 * Teardown of leftovers: requests without a requester (erased users) titled with the test prefix, drafts created
 * from test requests whose creator is gone, and temporary branches older than `staleBefore` (or of this run).
 */
export async function deleteLeftoverTestRequests(staleBefore: number, runId?: string): Promise<number> {
  const db = adminClient();
  const orphans = await db.from("event_requests").select("id").is("requester_id", null).like("title", `${REQUEST_TITLE_PREFIX}%`);
  if (orphans.error) throw new Error(`find orphaned requests: ${orphans.error.message}`);
  await deleteRequests(orphans.data.map((r: { id: string }) => r.id));
  const drafts = await db.from("events").delete().like("title", `${REQUEST_TITLE_PREFIX}%`).lt("created_at", new Date(staleBefore).toISOString()).select("id");
  if (drafts.error) throw new Error(`delete leftover request drafts: ${drafts.error.message}`);
  const branches = await db.from("branches").select("id, name").like("name", `${TEMP_BRANCH_PREFIX}%`);
  if (branches.error) throw new Error(`find temporary branches: ${branches.error.message}`);
  for (const b of branches.data as { id: string; name: string }[]) {
    // Names are "<prefix><runId>-<created ms>-<label>" (branches have no created_at column).
    const created = Number(/-(\d{13})-/.exec(b.name)?.[1] ?? 0);
    if ((runId && b.name.startsWith(`${TEMP_BRANCH_PREFIX}${runId}-`)) || created < staleBefore) await deleteTempBranch(b.id);
  }
  return orphans.data.length + (drafts.data?.length ?? 0);
}

/** A branch in the seed region just for one test, so counts (badge, dashboard) are not shared with others. */
export async function createTempBranch(regionId: string, runId: string, label: string): Promise<string> {
  const name = `${TEMP_BRANCH_PREFIX}${runId}-${Date.now()}-${label}`;
  const { data, error } = await adminClient().from("branches").insert({ name, region_id: regionId }).select("id").single();
  if (error) throw new Error(`create branch: ${error.message}`);
  return (data as { id: string }).id;
}
/** Removes a temporary branch: its requests and events go, remaining profiles move to `fallbackBranch` first. */
export async function deleteTempBranch(id: string, fallbackBranch?: string): Promise<void> {
  const db = adminClient();
  const requests = await db.from("event_requests").select("id").eq("branch_id", id);
  await deleteRequests((requests.data ?? []).map((r: { id: string }) => r.id));
  await db.from("events").delete().eq("branch_id", id);
  const fallback = fallbackBranch ?? (await db.from("branches").select("id").not("name", "like", `${TEMP_BRANCH_PREFIX}%`).limit(1).single()).data?.id;
  if (fallback) await db.from("profiles").update({ branch_id: fallback }).eq("branch_id", id);
  const { error } = await db.from("branches").delete().eq("id", id);
  if (error) throw new Error(`delete branch: ${error.message}`);
}
