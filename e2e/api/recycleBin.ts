// User deletion / Recycle Bin helpers for tests. QA only: SupabaseClient runs the guard on import.
import { createClient } from "@supabase/supabase-js";
import { adminClient, clientAs } from "./SupabaseClient";
import { requireEnv, userPassword } from "../setup/env";

export type RecycleRow = { id: string; type: "user" | "event"; title: string; can_restore: boolean; self_requested: boolean };

/**
 * A fresh, uncached password sign-in. (SupabaseClient.signIn caches sessions per email, which would hide
 * a ban that happened after the first sign-in.) Returns the error message, or null when sign-in worked.
 */
export async function trySignIn(email: string, password = userPassword()): Promise<string | null> {
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (data.session) await client.auth.signOut().catch(() => undefined);
  return error ? error.message : data.session ? null : "no session";
}

/**
 * The same steps as the app's deleteUser server function (src/lib/delete-user.functions.ts): authorize +
 * soft-delete with audit (service role), ban the Auth account, then record completion. Used by API tests
 * that need a deleted user without going through the UI.
 */
export async function softDeleteUser(actorId: string, targetId: string, requestId?: string): Promise<void> {
  const admin = adminClient();
  const auth = await admin.rpc("authorize_user_deletion", { _actor: actorId, _target: targetId, ...(requestId ? { _request: requestId } : {}) });
  if (auth.error || !auth.data) throw new Error(`authorize_user_deletion: ${auth.error?.message ?? "no audit id"}`);
  const ban = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
  if (ban.error) throw new Error(`ban: ${ban.error.message}`);
  const done = await admin.rpc("record_user_deletion", { _actor: actorId, _target: targetId, _audit: auth.data });
  if (done.error) throw new Error(`record_user_deletion: ${done.error.message}`);
}

export async function listRecycleBinAs(email: string, search = "") {
  return (await clientAs(email)).rpc("list_recycle_bin", { _type: "user", _search: search, _offset: 0 });
}

/** Only for denied cases: a successful direct restore_item leaves the restore unfinished (the server function unbans). */
export async function restoreItemAs(email: string, id: string) {
  return (await clientAs(email)).rpc("restore_item", { _type: "user", _id: id });
}

/** Admin read of the soft-delete state. */
export async function deletionState(userId: string) {
  const profile = await adminClient().from("profiles").select("deleted_at, status").eq("id", userId).maybeSingle();
  const state = await adminClient().from("user_deletion_state").select("operation, self_requested").eq("target_id", userId).maybeSingle();
  if (profile.error || state.error) throw new Error(`read deletion state: ${profile.error?.message ?? state.error?.message}`);
  return { deletedAt: profile.data?.deleted_at ?? null, status: profile.data?.status ?? null, operation: state.data?.operation ?? null, selfRequested: state.data?.self_requested ?? null };
}
