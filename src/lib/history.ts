type Entry = { action: string; old_value: string | null; new_value: string | null };
const ROLES = ["regional_director", "branch_manager", "volunteer", "trustee"];
const roleKey = (v: string | null) =>
  v && ROLES.includes(v) ? `common.roles.${v}` : "common.noRole";

/** Turns a structured audit row into a translation key plus params (role params are keys to translate). */
export function historyChange(e: Entry): {
  key: string;
  params?: { from?: string; to?: string };
  branch?: boolean;
} {
  switch (e.action) {
    case "user_deleted":
      return { key: "history.userDeleted" };
    case "user_deletion_failed":
      return { key: "history.userDeletionFailed" };
    case "deletion_requested":
      return { key: "history.deletionRequested" };
    case "deletion_cancelled":
      return { key: "history.deletionCancelled" };
    case "role_change":
      return {
        key: "history.roleChange",
        params: { from: roleKey(e.old_value), to: roleKey(e.new_value) },
      };
    case "branch_change":
      return { key: "history.branchChange", branch: true };
  }
  if (e.old_value === "pending" && e.new_value === "active") return { key: "history.approved" };
  if (e.new_value === "active") return { key: "history.activated" };
  if (e.new_value === "inactive") return { key: "history.deactivated" };
  return { key: "history.setPending" };
}
