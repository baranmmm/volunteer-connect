import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { setTaskStatus } from "@/lib/tasks.functions";
import type { Task, TaskDetail, TaskStatus } from "@/lib/tasks";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";

/**
 * Changes a task's status with an optimistic update of the cached lists and detail; on failure the cache is
 * restored and an error toast is shown. Everything under the "tasks" key is refetched afterwards.
 */
export function useSetTaskStatus() {
  const queryClient = useQueryClient();
  const save = useServerFn(setTaskStatus);
  return async (id: string, status: TaskStatus) => {
    await queryClient.cancelQueries({ queryKey: ["tasks"] });
    const snapshot = queryClient.getQueriesData({ queryKey: ["tasks"] });
    queryClient.setQueriesData({ queryKey: ["tasks"] }, (old: unknown) => {
      if (Array.isArray(old))
        return (old as Task[]).map((t) =>
          t && t.id === id && "status" in t ? { ...t, status } : t,
        );
      if (old && typeof old === "object" && (old as TaskDetail).id === id && "status" in old)
        return { ...(old as TaskDetail), status };
      return old;
    });
    try {
      await save({ data: { id, status } });
    } catch (e) {
      for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
      toast.error(translateError(e));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  };
}
