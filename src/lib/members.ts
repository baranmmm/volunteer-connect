import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Profile } from "@/lib/auth";

export type Member = Profile & { roles: AppRole[] };

// RLS limits rows to the caller's own branch (managers) or region (directors).
export async function fetchMembers(selfId: string): Promise<Member[]> {
  const profiles: Profile[] = [];
  const roles = new Map<string, AppRole[]>();
  for (let offset = 0; ; offset += 500) {
    const p = await supabase
      .from("profiles")
      .select("*, branches(name, regions(name))")
      .neq("id", selfId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (p.error) throw p.error;
    profiles.push(...((p.data ?? []) as Profile[]));
    if ((p.data ?? []).length < 500) break;
  }
  for (let offset = 0; ; offset += 500) {
    const r = await supabase
      .from("user_roles")
      .select("user_id, role")
      .order("id")
      .range(offset, offset + 499);
    if (r.error) throw r.error;
    (r.data ?? []).forEach((x) => roles.set(x.user_id, [...(roles.get(x.user_id) ?? []), x.role]));
    if ((r.data ?? []).length < 500) break;
  }
  return profiles.map((m) => ({ ...m, roles: roles.get(m.id) ?? [] }));
}

export async function setStatus(userId: string, status: "active" | "inactive") {
  const { error } = await supabase.rpc("set_user_status", { _target: userId, _status: status });
  if (error) throw error;
}

export async function setRole(
  userId: string,
  role: "volunteer" | "branch_manager" | "regional_director",
  regionId?: string,
) {
  const { error } = await supabase.rpc("set_user_role", {
    _target: userId,
    _role: role,
    ...(regionId ? { _region: regionId } : {}),
  });
  if (error) throw error;
}

export async function setBranch(userId: string, branch: string) {
  const { error } = await supabase.rpc("set_user_branch", { _target: userId, _branch: branch });
  if (error) throw error;
}

export async function fetchDirectorBranches(userId: string) {
  const { data: role, error } = await supabase
    .from("user_roles")
    .select("region_id")
    .eq("user_id", userId)
    .eq("role", "regional_director")
    .maybeSingle();
  if (error) throw error;
  if (!role?.region_id) return [];
  const result = await supabase
    .from("branches")
    .select("id, name")
    .eq("region_id", role.region_id)
    .order("name");
  if (result.error) throw result.error;
  return result.data ?? [];
}

/** National Coordinators: every branch and region (to move Branch Managers and assign Regional Directors). */
export async function fetchAllBranchesAndRegions() {
  const [branches, regions] = await Promise.all([
    supabase.from("branches").select("id, name, region_id").order("name"),
    supabase.from("regions").select("id, name").order("name"),
  ]);
  if (branches.error) throw branches.error;
  if (regions.error) throw regions.error;
  return { branches: branches.data ?? [], regions: regions.data ?? [] };
}

export async function fetchHistory(userId: string, offset = 0) {
  const { data, error } = await supabase.rpc("get_user_audit_history", {
    _target: userId,
    _offset: offset,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMember(id: string): Promise<Member | null> {
  const [p, r] = await Promise.all([
    supabase.from("profiles").select("*, branches(name, regions(name))").eq("id", id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", id),
  ]);
  if (p.error) throw p.error;
  if (r.error) throw r.error;
  return p.data ? { ...(p.data as Profile), roles: (r.data ?? []).map((x) => x.role) } : null;
}

export type DeletionRequest = {
  id: string;
  user_id: string | null;
  requested_at: string;
  status: "pending" | "cancelled" | "completed";
  profiles: { full_name: string; email: string | null; branches: { name: string } | null } | null;
};

// RLS returns only requests from users the caller can manage (plus the caller's own).
export async function fetchPendingDeletionRequests(selfId: string): Promise<DeletionRequest[]> {
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select(
      "id, user_id, requested_at, status, profiles!account_deletion_requests_user_id_fkey(full_name, email, branches(name))",
    )
    .eq("status", "pending")
    .neq("user_id", selfId)
    .order("requested_at");
  if (error) throw error;
  return (data ?? []) as DeletionRequest[];
}

export async function fetchMyDeletionRequest(selfId: string) {
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("id, requested_at")
    .eq("user_id", selfId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function requestAccountDeletion() {
  const { error } = await supabase.rpc("request_account_deletion");
  if (error) throw error;
}

export async function cancelAccountDeletion() {
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) throw error;
}
