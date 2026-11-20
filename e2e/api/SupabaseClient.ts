// Node-only Supabase helpers for seed, teardown, fixtures and API tests.
// The service_role key is used ONLY here (never in browser code).
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, userPassword } from "../setup/env";
import { QA_REF, assertQaEnvironment } from "../setup/guard";

assertQaEnvironment();

export type AppRole = "regional_director" | "branch_manager" | "volunteer";
export type ProfileStatus = "pending" | "active" | "inactive";
export type Lang = "en" | "tr";

const isNewKey = (key: string) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");

// Same header handling as the app's generated client: new opaque API keys are not bearer JWTs.
function keyedFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

function make(key: string, accessToken?: string): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), key, {
    global: { fetch: keyedFetch(key), ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let admin: SupabaseClient | undefined;
/** Service-role client: bypasses RLS. Seed, teardown, fixtures and assertions only. */
export const adminClient = () => (admin ??= make(requireEnv("SUPABASE_SERVICE_ROLE_KEY")));
/** Anonymous client (publishable key, no user). */
export const anonClient = () => make(requireEnv("SUPABASE_PUBLISHABLE_KEY"));
/** Client acting as a signed-in user (RLS applies). */
export const userClient = (accessToken: string) => make(requireEnv("SUPABASE_PUBLISHABLE_KEY"), accessToken);

const sessions = new Map<string, Promise<Session>>();
/** Password sign-in, cached per process so test runs stay well under Supabase's auth rate limits. */
export function signIn(email: string, password = userPassword()): Promise<Session> {
  let session = sessions.get(email);
  if (!session) {
    session = anonClient()
      .auth.signInWithPassword({ email, password })
      .then(({ data, error }) => {
        if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`);
        return data.session;
      });
    sessions.set(email, session);
    session.catch(() => sessions.delete(email));
  }
  return session;
}

export async function clientAs(email: string): Promise<SupabaseClient> {
  return userClient((await signIn(email)).access_token);
}

/** Playwright storageState for a signed-in session (supabase-js keeps it in localStorage). */
export function storageStateFor(session: Session, origin: string, language: Lang | null = "en") {
  const localStorage = [{ name: `sb-${QA_REF}-auth-token`, value: JSON.stringify(session) }];
  if (language) localStorage.push({ name: "dsvh-language", value: language });
  return { cookies: [], origins: [{ origin, localStorage }] };
}

export type UserSpec = {
  email: string;
  fullName: string;
  phone?: string;
  branchId: string | null;
  role: AppRole;
  regionId?: string | null;
  status: ProfileStatus;
  language?: Lang;
};

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function listAllUsers() {
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

/**
 * Creates (or resets) a confirmed user through the Admin API and forces its profile, status and
 * single role with the service role. `existingId` skips the lookup for brand-new users.
 */
export async function ensureUser(spec: UserSpec, existingId?: string | null): Promise<string> {
  const db = adminClient();
  const language = spec.language ?? "en";
  const metadata = { full_name: spec.fullName, phone: spec.phone ?? "07000000000", branch_id: spec.branchId ?? "", preferred_language: language };
  let id = existingId ?? null;
  if (!id) {
    const created = await db.auth.admin.createUser({ email: spec.email, password: userPassword(), email_confirm: true, user_metadata: metadata });
    if (created.error || !created.data.user) throw new Error(`createUser ${spec.email}: ${created.error?.message}`);
    id = created.data.user.id;
  } else {
    const updatedUser = await db.auth.admin.updateUserById(id, { password: userPassword(), email_confirm: true, user_metadata: metadata });
    if (updatedUser.error) throw new Error(`updateUser ${spec.email}: ${updatedUser.error.message}`);
  }

  const updated = check(
    await db
      .from("profiles")
      .update({ full_name: spec.fullName, phone: metadata.phone, branch_id: spec.branchId, status: spec.status, preferred_language: language })
      .eq("id", id)
      .select("id"),
    `update profile ${spec.email}`,
  );
  if (!updated?.length) throw new Error(`Profile for ${spec.email} was not created by the handle_new_user trigger. Has migrate run?`);

  check(await db.from("user_roles").delete().eq("user_id", id), `clear roles ${spec.email}`);
  check(
    await db.from("user_roles").insert({ user_id: id, role: spec.role, region_id: spec.role === "regional_director" ? (spec.regionId ?? null) : null }),
    `insert role ${spec.email}`,
  );
  // A seeded user must not carry a leftover deletion request from an earlier run.
  check(await db.from("account_deletion_requests").update({ status: "cancelled", handled_at: new Date().toISOString() }).eq("user_id", id).eq("status", "pending"), `reset deletion requests ${spec.email}`);
  return id;
}

export async function deleteAuthUser(id: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(id);
  if (error && !/not.?found/i.test(error.message)) throw new Error(`deleteUser ${id}: ${error.message}`);
}

/** Admin reads used by assertions. */
export async function getProfile(id: string) {
  return check(await adminClient().from("profiles").select("id, full_name, phone, branch_id, status, preferred_language").eq("id", id).maybeSingle(), "read profile");
}

export async function getRoles(id: string): Promise<AppRole[]> {
  const rows = check(await adminClient().from("user_roles").select("role").eq("user_id", id), "read roles");
  return (rows ?? []).map((r: { role: AppRole }) => r.role);
}

export async function userExists(id: string): Promise<boolean> {
  const { data, error } = await adminClient().auth.admin.getUserById(id);
  if (error && /not.?found/i.test(error.message)) return false;
  if (error) throw new Error(`getUserById: ${error.message}`);
  return !!data.user;
}

export async function pendingDeletionRequest(userId: string) {
  return check(
    await adminClient().from("account_deletion_requests").select("id, status").eq("user_id", userId).eq("status", "pending").maybeSingle(),
    "read deletion request",
  );
}

export async function getDeletionRequest(id: string) {
  return check(await adminClient().from("account_deletion_requests").select("id, status, user_id").eq("id", id).maybeSingle(), "read deletion request");
}
