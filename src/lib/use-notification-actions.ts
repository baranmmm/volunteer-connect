import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Notification, NotificationCounts } from "@/lib/notifications";
import { markNotificationsRead } from "@/lib/notifications.functions";
import { DASHBOARD_WORK_KEY } from "@/lib/use-dashboard-work";

/** The header bell's badge: the count up to 9, then "9+". */
export const bellBadge = (count: number) => (count > 9 ? "9+" : String(count));

/** Query key of the Notifications page list (refreshed with the bell's data after marking notices read). */
export const NOTIFICATIONS_PAGE_KEY = "notifications-page";
const REFRESH_KEYS = [DASHBOARD_WORK_KEY, "notification-counts", NOTIFICATIONS_PAGE_KEY];

type WorkData = { notifications: Notification[] | null } & Record<string, unknown>;
type PageData = InfiniteData<Notification[]>;

/**
 * Opening a notice (marks it read and goes to its item), a daily summary (marks the summary line read) and "Mark all
 * as read", shared by the header bell and the Notifications page. The lists and the badge update at once
 * (optimistic) and are refetched after the server call.
 */
export function useNotificationActions(onNavigate?: () => void) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const markRead = useServerFn(markNotificationsRead);
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    Promise.all(REFRESH_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
  /** Optimistic: the notices `id` (or all, when no id) read in every cached list; the unread total goes down. */
  const markLocally = (id?: string) => {
    const now = new Date().toISOString();
    const mark = (list: Notification[]) =>
      list.map((n) => (!n.read_at && (!id || n.id === id) ? { ...n, read_at: now } : n));
    qc.setQueriesData<WorkData>({ queryKey: [DASHBOARD_WORK_KEY] }, (old) =>
      old?.notifications ? { ...old, notifications: mark(old.notifications) } : old,
    );
    qc.setQueriesData<PageData>({ queryKey: [NOTIFICATIONS_PAGE_KEY] }, (old) =>
      old ? { ...old, pages: old.pages.map(mark) } : old,
    );
    qc.setQueriesData<NotificationCounts>({ queryKey: ["notification-counts"] }, (old) =>
      old
        ? id
          ? { ...old, total: Math.max(0, old.total - 1) }
          : { tasks: 0, requests: 0, meetings: 0, total: 0 }
        : old,
    );
  };
  const readOne = (n: Notification) => {
    if (n.read_at) return;
    markLocally(n.id);
    void markRead({ data: { id: n.id } }).then(refresh, refresh);
  };
  function open(n: Notification) {
    readOne(n);
    onNavigate?.();
    void navigate({ href: n.link });
  }
  async function markAll() {
    setBusy(true);
    try {
      await markRead({ data: {} });
      markLocally();
      await refresh();
      toast.success(t("notifications.allRead"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  /** Opening a daily summary marks the summary line itself read (its items stay unread until opened). */
  const readDigest = readOne;
  return { open, markAll, readDigest, busy };
}
