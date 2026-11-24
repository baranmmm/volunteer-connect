import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { NotificationEntries } from "@/components/app/NotificationsCard";
import { NOTIFICATIONS_PAGE_KEY, useNotificationActions } from "@/lib/use-notification-actions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { listMyNotificationsPage, NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications.functions";
import { useWorkMember } from "@/lib/use-work-notices";

export const Route = createFileRoute("/_app/notifications")({
  ssr: false,
  head: () => pageHead("Notifications", "Your Dialogue Society Volunteer Hub notifications."),
  component: NotificationsPage,
});

/**
 * Every notice of the signed-in member, read and unread, newest first. Pages of NOTIFICATIONS_PAGE_SIZE are fetched
 * from the database with a (created_at, id) cursor; "Load more" asks for the next one. Followers have no notices.
 */
function NotificationsPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const fetchPage = useServerFn(listMyNotificationsPage);
  const { open, markAll, readDigest, busy } = useNotificationActions();
  const list = useInfiniteQuery({
    queryKey: [NOTIFICATIONS_PAGE_KEY, session?.user.id],
    queryFn: ({ pageParam }) => fetchPage({ data: pageParam ?? {} }),
    initialPageParam: null as { before: string; beforeId: string } | null,
    getNextPageParam: (last) => {
      const tail = last[last.length - 1];
      return last.length === NOTIFICATIONS_PAGE_SIZE && tail
        ? { before: tail.created_at, beforeId: tail.id }
        : undefined;
    },
    enabled: member,
  });
  if (!member) return <Navigate to="/dashboard" replace />;
  const items = list.data?.pages.flat() ?? [];
  const unread = items.some((n) => !n.read_at);
  return (
    <section
      data-testid="notifications-page"
      aria-labelledby="notifications-page-title"
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <h1 id="notifications-page-title" className="text-2xl font-bold">
            {t("notifications.title")}
          </h1>
        </div>
        {unread && (
          <Button
            variant="outline"
            size="sm"
            data-testid="notifications-page-mark-all"
            disabled={busy}
            onClick={() => void markAll()}
          >
            <CheckCheck />
            {t("notifications.markAll")}
          </Button>
        )}
      </div>
      <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft sm:p-6">
        {list.isLoading ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : list.isError && items.length === 0 ? (
          <div role="alert" className="space-y-2">
            <p className="text-destructive">{t("notifications.loadError")}</p>
            <Button variant="outline" onClick={() => void list.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p data-testid="notifications-page-empty" className="text-muted-foreground">
            {t("notifications.empty")}
          </p>
        ) : (
          <NotificationEntries items={items} onOpen={open} onExpandDigest={readDigest} />
        )}
        {list.hasNextPage && (
          <Button
            data-testid="notifications-page-load-more"
            variant="outline"
            className="mt-4"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t("common.loading") : t("notifications.loadMore")}
          </Button>
        )}
      </div>
    </section>
  );
}
