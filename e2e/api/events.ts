// Event test data. Events are created and cancelled as the (fresh) user through the app's own RPCs, so
// RLS, validate_event and created_by behave exactly as in the app. Only cleanup uses the service role.
import { adminClient, clientAs } from "./SupabaseClient";

/** Every test event title starts with this, so teardown can find leftovers. */
export const EVENT_TITLE_PREFIX = "E2E Event ";

export type EventStatus = "draft" | "published";
export type EventSpec = {
  title: string;
  branchId: string;
  status: EventStatus;
  /** Timed event: start relative to now. Omit both for an unscheduled draft. */
  startInMinutes?: number;
  durationMinutes?: number;
};

function payload(spec: EventSpec) {
  const timed = spec.startInMinutes !== undefined;
  const start = timed ? new Date(Date.now() + spec.startInMinutes! * 60_000) : null;
  const end = start ? new Date(start.getTime() + (spec.durationMinutes ?? 60) * 60_000) : null;
  return {
    title: spec.title,
    description: "",
    location: "E2E Community Hall",
    location_type: "in_person",
    online_url: null,
    organizer: "E2E",
    category: "dialogue",
    all_day: false,
    start_date: null,
    end_date: null,
    start_at: start?.toISOString() ?? null,
    end_at: end?.toISOString() ?? null,
    capacity: null,
    scope: "branch",
    branch_id: spec.branchId,
    status: spec.status,
  };
}

/** create_event as `email` (a branch manager or regional director); returns the new event id. */
export async function createEventAs(email: string, spec: EventSpec): Promise<string> {
  const { data, error } = await (await clientAs(email)).rpc("create_event", { _data: payload(spec) });
  if (error || !data) throw new Error(`create_event "${spec.title}": ${error?.message ?? "no id"}`);
  return String(data);
}

export async function cancelEventAs(email: string, id: string): Promise<void> {
  const { error } = await (await clientAs(email)).rpc("cancel_event", { _event: id });
  if (error) throw new Error(`cancel_event ${id}: ${error.message}`);
}

/** Service-role cleanup. Media and deletion jobs cascade. */
export async function deleteEvents(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await adminClient().from("events").delete().in("id", ids);
  if (error) throw new Error(`delete events: ${error.message}`);
}

/**
 * Teardown of test events left by interrupted runs. Deletes ONLY:
 *  1. events created by the given fresh-* users (call this before deleting those users), and
 *  2. events titled with EVENT_TITLE_PREFIX whose creator no longer exists (created_by is NULL because
 *     created_by is ON DELETE SET NULL, i.e. a fresh user deleted before its events).
 * Any other event, including a prefixed one created by a real or seeded user, is never touched.
 */
export async function deleteLeftoverTestEvents(freshUserIds: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < freshUserIds.length; i += 100) {
    const { data, error } = await adminClient().from("events").delete().in("created_by", freshUserIds.slice(i, i + 100)).select("id");
    if (error) throw new Error(`delete fresh users' events: ${error.message}`);
    deleted += data?.length ?? 0;
  }
  const { data, error } = await adminClient().from("events").delete().like("title", `${EVENT_TITLE_PREFIX}%`).is("created_by", null).select("id");
  if (error) throw new Error(`delete orphaned test events: ${error.message}`);
  return deleted + (data?.length ?? 0);
}
