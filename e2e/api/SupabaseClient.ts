// Node-only Supabase helpers for seed, teardown, fixtures and API tests.
// The service_role key is used ONLY here (never in browser code).
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, userPassword } from "../setup/env";
import { assertQaEnvironment } from "../setup/guard";

assertQaEnvironment();

export type AppRole = "regional_director" | "branch_manager" | "volunteer" | "trustee" | "follower" | "national_coordinator";
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
  // supabase-js's default storage key: sb-<first label of the API host>-auth-token (the QA ref, or "127" locally).
  const ref = new URL(requireEnv("SUPABASE_URL")).hostname.split(".")[0];
  const localStorage = [{ name: `sb-${ref}-auth-token`, value: JSON.stringify(session) }];
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
  /** Followed branch (sign-up requires one). Followers keep exactly this one; defaults to branchId or any branch. */
  followBranchId?: string | null;
};

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function listAllUsers() {
  const users: { id: string; email?: string; created_at: string }[] = [];
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
let privacyVersion: Promise<string> | undefined;
/** The privacy notice version the database requires (defined once, in privacy_notice_version()). */
export function currentPrivacyVersion(): Promise<string> {
  privacyVersion ??= Promise.resolve(adminClient().rpc("privacy_notice_version")).then(({ data, error }) => {
    if (error || !data) throw new Error(`privacy_notice_version: ${error?.message ?? "no version"}`);
    return data as string;
  });
  return privacyVersion;
}

export async function ensureUser(spec: UserSpec, existingId?: string | null): Promise<string> {
  const db = adminClient();
  const language = spec.language ?? "en";
  // Test users have confirmed the current privacy notice (sign-up refuses accounts without it).
  const privacyVersion = await currentPrivacyVersion();
  const followBranchId = spec.followBranchId ?? spec.branchId ?? (await anyBranchId());
  const metadata = { full_name: spec.fullName, phone: spec.phone ?? "07000000000", branch_id: followBranchId, preferred_language: language, privacy_notice_version: privacyVersion };
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

  // Exactly one role. The kept role is never deleted and re-inserted: the last active National Coordinator's role
  // cannot be removed, not even for a moment.
  check(await db.from("user_roles").delete().eq("user_id", id).neq("role", spec.role), `clear roles ${spec.email}`);
  check(
    await db.from("user_roles").upsert(
      { user_id: id, role: spec.role, region_id: spec.role === "regional_director" ? (spec.regionId ?? null) : null },
      { onConflict: "user_id,role" },
    ),
    `set role ${spec.email}`,
  );
  // Followers follow exactly their one branch (reset for seeded users); members follow their own branch implicitly.
  if (spec.role === "follower") {
    check(await db.from("user_followed_branches").delete().eq("user_id", id), `reset followed branches ${spec.email}`);
    check(await db.from("user_followed_branches").insert({ user_id: id, branch_id: followBranchId }), `follow branch ${spec.email}`);
  }
  // Existing (seeded) users confirm the current version too; new users got it from the sign-up trigger.
  check(await db.from("privacy_notice_acceptances").upsert({ user_id: id, notice_version: privacyVersion }, { onConflict: "user_id,notice_version", ignoreDuplicates: true }), `confirm privacy notice ${spec.email}`);
  // A seeded user must not carry a leftover deletion request from an earlier run.
  check(await db.from("account_deletion_requests").update({ status: "cancelled", handled_at: new Date().toISOString() }).eq("user_id", id).eq("status", "pending"), `reset deletion requests ${spec.email}`);
  return id;
}

let someBranch: Promise<string> | undefined;
/** Any live branch, for accounts without one (sign-up needs a followed branch). */
function anyBranchId(): Promise<string> {
  someBranch ??= Promise.resolve(adminClient().from("branches").select("id").is("deleted_at", null).order("name").limit(1).single()).then(({ data, error }) => {
    if (error || !data) throw new Error(`no branch: ${error?.message ?? "none"}`);
    return (data as { id: string }).id;
  });
  return someBranch;
}

/**
 * National Coordinators act only with MFA: enrols a TOTP factor for the user (removing earlier ones) and returns its
 * secret, which stays in memory (fresh NCs) or goes to the caller's secret store (the seeded NC). Never printed.
 */
export async function enrollTotp(email: string, password = userPassword()): Promise<string> {
  const client = make(requireEnv("SUPABASE_PUBLISHABLE_KEY"));
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user) throw new Error(`enrol sign-in ${email}: ${signedIn.error?.message}`);
  const existing = await adminClient().auth.admin.mfa.listFactors({ userId: signedIn.data.user.id });
  for (const f of existing.data?.factors ?? []) await adminClient().auth.admin.mfa.deleteFactor({ userId: signedIn.data.user.id, id: f.id });
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `e2e-${Date.now()}` });
  if (enrolled.error) throw new Error(`enrol ${email}: ${enrolled.error.message}`);
  const secret = enrolled.data.totp.secret;
  const { totp } = await import("./totp");
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(secret) });
  if (verified.error) throw new Error(`verify ${email}: ${verified.error.message}`);
  return secret;
}

const aal2Sessions = new Map<string, Promise<Session>>();
/** Password sign-in plus the TOTP step: an aal2 session (cached per process). */
export function signInAal2(email: string, secret: string): Promise<Session> {
  let session = aal2Sessions.get(email);
  if (!session) {
    session = (async () => {
      const client = make(requireEnv("SUPABASE_PUBLISHABLE_KEY"));
      const signedIn = await client.auth.signInWithPassword({ email, password: userPassword() });
      if (signedIn.error) throw new Error(`Sign-in failed for ${email}: ${signedIn.error.message}`);
      const factors = await client.auth.mfa.listFactors();
      const factor = factors.data?.totp.find((f) => f.status === "verified");
      if (!factor) throw new Error(`${email} has no verified TOTP factor`);
      const { totp } = await import("./totp");
      const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
      if (verified.error) throw new Error(`MFA failed for ${email}: ${verified.error.message}`);
      const { data } = await client.auth.getSession();
      if (!data.session) throw new Error(`No aal2 session for ${email}`);
      return data.session;
    })();
    aal2Sessions.set(email, session);
    session.catch(() => aal2Sessions.delete(email));
  }
  return session;
}

/** A client acting as a National Coordinator with an aal2 (MFA) session. */
export async function clientAsAal2(email: string, secret: string): Promise<SupabaseClient> {
  return userClient((await signInAal2(email, secret)).access_token);
}

export async function deleteAuthUser(id: string): Promise<void> {
  // A soft-deleted (Recycle Bin) test user has a user_deletion_state row with no foreign key to the user; the
  // app's purge removes it, so do the same here instead of leaving an orphan behind.
  const state = await adminClient().from("user_deletion_state").delete().eq("target_id", id);
  if (state.error) throw new Error(`delete deletion state ${id}: ${state.error.message}`);
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
