import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Profile } from "@/lib/auth";

export type Member = Profile & { roles: AppRole[] };

// RLS limits rows to the caller's own branch (managers) or region (directors).
export async function fetchMembers(selfId: string): Promise<Member[]> {
  const [p, r] = await Promise.all([
    supabase.from("profiles").select("*, branches(name, regions(name))").neq("id", selfId).order("created_at", { ascending: false }),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (p.error) throw p.error;
  const roles = new Map<string, AppRole[]>();
  (r.data ?? []).forEach((x) => roles.set(x.user_id, [...(roles.get(x.user_id) ?? []), x.role]));
  return ((p.data ?? []) as Profile[]).map((m) => ({ ...m, roles: roles.get(m.id) ?? [] }));
}

export async function setStatus(userId: string, status: "active" | "inactive") {
  const { error } = await supabase.rpc("set_user_status", { _target: userId, _status: status });
  if (error) throw error;
}
