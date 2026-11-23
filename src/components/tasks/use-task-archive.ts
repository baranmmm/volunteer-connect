import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { archiveDoneTasks, archiveTask } from "@/lib/tasks.functions";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";

/**
 * Archive / unarchive one done task, and "Archive all done" for a list of ids. Archive is not delete: archived tasks
 * are only hidden from the default views. Shows a toast and refetches everything under the "tasks" key.
 */
export function useTaskArchive() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const one = useServerFn(archiveTask);
  const many = useServerFn(archiveDoneTasks);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });
  return {
    async setArchived(id: string, archived: boolean) {
      try {
        await one({ data: { id, archived } });
        toast.success(archived ? t("tasks.archive.archived") : t("tasks.archive.unarchived"));
        await refresh();
        return true;
      } catch (e) {
        toast.error(translateError(e));
        return false;
      }
    },
    async archiveDone(ids: string[]) {
      if (!ids.length) return;
      try {
        const { archived } = await many({ data: { ids } });
        toast.success(t("tasks.archive.archivedMany", { count: archived }));
        await refresh();
      } catch (e) {
        toast.error(translateError(e));
      }
    },
  };
}
