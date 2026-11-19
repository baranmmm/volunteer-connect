import type { AppRole, Profile } from "@/lib/auth";

type ListedMember = Pick<Profile, "id" | "full_name" | "email" | "status" | "branch_id"> & { roles: AppRole[] };
export type MemberFilters = { search: string; status: string; role: string; branch: string };

export function filterMembers<T extends ListedMember>(members: T[], filters: MemberFilters): T[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return members.filter((m) =>
    (filters.status === "all" || m.status === filters.status) &&
    (filters.role === "all" || m.roles.includes(filters.role as AppRole)) &&
    (filters.branch === "all" || m.branch_id === filters.branch) &&
    (!search || `${m.full_name} ${m.email ?? ""}`.toLocaleLowerCase().includes(search))
  );
}

export function canEditRoleOrBranch(status: Profile["status"] | undefined, roles: AppRole[]) {
  return status === "active" && roles.includes("regional_director");
}

export function isLastBranchManager(target: ListedMember, members: ListedMember[]) {
  return target.branch_id !== null && target.roles.includes("branch_manager") &&
    !members.some((m) => m.id !== target.id && m.branch_id === target.branch_id && m.roles.includes("branch_manager"));
}
/** Returns why a manager may not delete this user yet, or null. Deletion requests skip the inactive rule. */
export function deleteBlockReason(status: Profile["status"], fromRequest = false) {
  return fromRequest || status === "inactive" ? null : "Deactivate the user first";
}

/** Days left of the 30-day UK GDPR window for a deletion request (never below 0). */
export function deletionDaysRemaining(requestedAt: string, now = new Date()) {
  const elapsed = Math.floor((now.getTime() - new Date(requestedAt).getTime()) / 86_400_000);
  return Math.max(0, 30 - elapsed);
}
