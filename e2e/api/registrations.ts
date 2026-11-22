// A2b registrations through the app's RPCs with each user's own token; reads for assertions use the service
// role. Registrations of test events are removed with the events (ON DELETE CASCADE) and teardown also
// deletes fresh users' registrations.
import { adminClient, clientAs } from "./SupabaseClient";

export type RegistrationStatus = "registered" | "waitlisted" | "cancelled" | "attended" | "no_show";
export type RegistrationResult = { registration_id: string; status: RegistrationStatus; waitlist_position: number | null };
export type RegistrationSummary = {
  capacity: number | null; registration_enabled: boolean; registered_count: number; waitlisted_count: number; spots_left: number | null;
  over_capacity: boolean; my_registration_id: string | null; my_status: RegistrationStatus | null; my_show_name: boolean;
  my_waitlist_position: number | null; names_visible: boolean; names: string[];
};
export type RegistrationRow = { id: string; event_id: string; user_id: string | null; status: RegistrationStatus; show_name: boolean; notice: string | null; notice_seen_at: string | null; registered_at: string };

async function rpc<T>(email: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (await clientAs(email)).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
export const registerAs = (email: string, eventId: string, showName = false) => rpc<RegistrationResult>(email, "register_for_event", { p_event_id: eventId, p_show_name: showName });
export const cancelRegistrationAs = (email: string, eventId: string) => rpc<RegistrationResult>(email, "cancel_registration", { p_event_id: eventId });
export const summaryAs = (email: string, eventId: string) => rpc<RegistrationSummary>(email, "get_event_registration_summary", { p_event_id: eventId });

/** Service-role read of every registration row of an event, oldest first. */
export async function registrationsOf(eventId: string): Promise<RegistrationRow[]> {
  const { data, error } = await adminClient().from("event_registrations").select("id, event_id, user_id, status, show_name, notice, notice_seen_at, registered_at").eq("event_id", eventId).order("registered_at");
  if (error) throw new Error(`read registrations: ${error.message}`);
  return data as RegistrationRow[];
}
export async function registrationOf(eventId: string, userId: string): Promise<RegistrationRow | undefined> {
  return (await registrationsOf(eventId)).find((r) => r.user_id === userId);
}
