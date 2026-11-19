import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isLang, setLanguage } from "@/lib/i18n";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"] & {
  branches: { name: string; regions: { name: string } | null } | null;
};

type AuthState = {
  /** True until the initial session AND (if signed in) the profile/roles have loaded. */
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  isManager: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);


export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const requestId = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);

  // Exactly one listener, registered before getSession(). The callback is synchronous:
  // awaiting Supabase calls inside it deadlocks supabase-js.
  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      // Only replace state when the signed-in user actually changes, so token refreshes
      // and focus events don't cause re-renders or refetches.
      setSession((prev) => (prev?.user.id === s?.user.id && prev?.access_token === s?.access_token ? prev : s));
      setSessionReady(true);
      // Defer reads to the effect; never await Supabase inside its auth callback.
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") setRefreshVersion((v) => v + 1);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession((prev) => prev ?? data.session);
      setSessionReady(true);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(async (uid: string) => {
    const id = ++requestId.current;
    const [p, r] = await Promise.all([
      supabase.from("profiles").select("*, branches(name, regions(name))").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    if (id !== requestId.current) return; // a newer request (or sign-out) superseded this one
    const prof = (p.data as Profile) ?? null;
    // After sign-in the saved profile language wins and is mirrored to localStorage.
    if (prof && isLang(prof.preferred_language)) setLanguage(prof.preferred_language);
    setProfile(prof);
    setRoles((r.data ?? []).map((x) => x.role));
    setLoadedFor(uid);
  }, []);

  // Profile/roles load in their own effect, keyed on the user id only.
  useEffect(() => {
    if (!userId) {
      requestId.current++;
      setProfile(null);
      setRoles([]);
      setLoadedFor(null);
      return;
    }
    loadProfile(userId).catch(() => setLoadedFor(userId));
  }, [userId, loadProfile, refreshVersion]);

  const refresh = useCallback(async () => {
    if (userId) await loadProfile(userId);
  }, [userId, loadProfile]);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      // If the server call failed, still drop the locally stored session.
      if (error) await supabase.auth.signOut({ scope: "local" });
    } catch {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    } finally {
      requestId.current++;
      setSession(null);
      setProfile(null);
      setRoles([]);
      setLoadedFor(null);
    }
  }, []);

  const loading = !sessionReady || (userId !== null && loadedFor !== userId);
  const isManager = roles.includes("branch_manager") || roles.includes("regional_director");

  return (
    <AuthContext.Provider value={{ loading, session, profile, roles, isManager, refresh, signOut }}>
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
