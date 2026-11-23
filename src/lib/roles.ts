import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

/** Highest role: follower < volunteer < branch_manager < regional_director < national_coordinator. */
export const ROLE_RANK: AppRole[] = ["follower", "volunteer", "branch_manager", "regional_director", "national_coordinator"];
export function primaryRole(roles: AppRole[]): AppRole {
  for (const role of [...ROLE_RANK].reverse()) if (roles.includes(role)) return role;
  return "follower";
}
/** No member (volunteer and above) or coordinator role. */
export const isFollowerRoles = (roles: AppRole[]) => primaryRole(roles) === "follower";
export const isNationalCoordinator = (roles: AppRole[]) => roles.includes("national_coordinator");
