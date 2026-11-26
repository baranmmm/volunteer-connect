import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Highest role: follower < volunteer < branch_manager < regional_director < national_coordinator. A trustee sits beside
 * volunteer (a read-only branch member, not a step on the ladder); a person never holds both.
 */
export const ROLE_RANK: AppRole[] = [
  "follower",
  "trustee",
  "volunteer",
  "branch_manager",
  "regional_director",
  "national_coordinator",
];
export function primaryRole(roles: AppRole[]): AppRole {
  for (const role of [...ROLE_RANK].reverse()) if (roles.includes(role)) return role;
  return "follower";
}
/** No member (volunteer and above) or coordinator role. */
export const isFollowerRoles = (roles: AppRole[]) => primaryRole(roles) === "follower";
export const isNationalCoordinator = (roles: AppRole[]) => roles.includes("national_coordinator");
/** A branch trustee: reads what a volunteer of the branch reads, creates and edits nothing (the database refuses it). */
export const isTrusteeRoles = (roles: AppRole[]) => primaryRole(roles) === "trustee";
