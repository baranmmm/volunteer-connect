import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { isTrusteeRoles } from "@/lib/roles";
import { isSingleScope } from "@/lib/tasks";
import { listMyWorkScopes, type WorkScopeOption } from "@/lib/work-scopes";

const NONE: WorkScopeOption[] = [];

/**
 * Where the caller may create tasks and meetings (list_my_work_scopes), shared by the tasks and meetings screens.
 * `single` is true when there is exactly one scope: forms then use it without showing a "Where" field, and cards,
 * rows, panels and calendar items hide scope/branch labels (every item the user sees comes from that one place).
 * Shares the ["work-scopes", uid] query cache with the existing callers.
 * `canCreate` is false for trustees: their branch is still their scope (labels stay hidden), but they create and edit
 * nothing (the database refuses it), so New task / New meeting / Add task are not shown.
 */
export function useWorkScopes(): {
  scopes: WorkScopeOption[];
  single: boolean;
  canCreate: boolean;
  loading: boolean;
} {
  const { session, roles } = useAuth();
  const uid = session?.user.id;
  const fetchScopes = useServerFn(listMyWorkScopes);
  const query = useQuery({
    queryKey: ["work-scopes", uid],
    queryFn: () => fetchScopes(),
    enabled: !!uid,
  });
  const scopes = query.data ?? NONE;
  return {
    scopes,
    single: isSingleScope(scopes),
    canCreate: scopes.length > 0 && !isTrusteeRoles(roles),
    loading: query.isLoading,
  };
}
