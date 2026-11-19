import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"] & {
  branches: { name: string; regions: { name: string } | null } | null;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  isManager: boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export const ROLE_LABELS: Record<AppRole, string> = {
  regional_director: "Regional Director",
  branch_manager: "Branch Manager",
  volunteer: "Volunteer",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setProfile(null);
      setRoles([]);
      setLoading(false);
      return;
    }
    const uid = s.user.id;
    const [p, r] = await Promise.all([
      supabase.from("profiles").select("*, branches(name, regions(name))").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((p.data as Profile) ?? null);
    setRoles((r.data ?? []).map((x) => x.role));
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setTimeout(() => load(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await load(data.session);
  }, [load]);

  const isManager = roles.includes("branch_manager") || roles.includes("regional_director");

  return (
    <AuthContext.Provider value={{ loading, session, profile, roles, isManager, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function primaryRole(roles: AppRole[]): AppRole {
  if (roles.includes("regional_director")) return "regional_director";
  if (roles.includes("branch_manager")) return "branch_manager";
  return "volunteer";
}
