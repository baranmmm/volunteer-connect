import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTaskGroup, listTaskGroups } from "@/lib/tasks.functions";

/** Query keys under "tasks", so every task change (status, notes, archive) refreshes the groups too. */
export const taskGroupsKey = (uid: string | undefined) => ["tasks", "groups", uid] as const;
export const taskGroupKey = (id: string) => ["tasks", "group", id] as const;

/** Every task group the caller can see. */
export function useTaskGroups(uid: string | undefined) {
  const fetchGroups = useServerFn(listTaskGroups);
  return useQuery({
    queryKey: taskGroupsKey(uid),
    queryFn: () => fetchGroups(),
    enabled: !!uid,
  });
}

/** One group as get_task_group returns it (null when not visible). */
export function useTaskGroup(id: string | null) {
  const fetchGroup = useServerFn(getTaskGroup);
  return useQuery({
    queryKey: taskGroupKey(id ?? "none"),
    queryFn: () => fetchGroup({ data: { id: id! } }),
    enabled: !!id,
  });
}
