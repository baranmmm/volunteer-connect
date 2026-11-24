import { useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck, ChevronDown } from "lucide-react";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Notification } from "@/lib/notifications";
import { groupText, notificationText } from "@/lib/notification-text";
import { entryUnread, groupNotifications, type NoticeEntry } from "@/lib/notification-groups";
import { markNotificationsRead } from "@/lib/notifications.functions";
import { DASHBOARD_WORK_KEY, useDashboardWork } from "@/lib/use-dashboard-work";
import { useWorkMember } from "@/lib/use-work-notices";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Dashboard: the latest in-app notices; opening one goes to its item and marks it read. Similar unread notices are one
 * expandable line ("4 tasks in Medway were completed"), and a daily summary holds the notices it brought.
 */
export function NotificationsCard() {
  const { t } = useTranslation();
  const member = useWorkMember();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const markRead = useServerFn(markNotificationsRead);
  const query = useDashboardWork();
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    Promise.all(
      [DASHBOARD_WORK_KEY, "notification-counts"].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
  function open(n: Notification) {
    if (!n.read_at) void markRead({ data: { id: n.id } }).then(refresh, () => undefined);
    void navigate({ href: n.link });
  }
  async function markAll() {
    setBusy(true);
    try {
      await markRead({ data: {} });
      await refresh();
      toast.success(t("notifications.allRead"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  /** Opening a daily summary marks the summary line itself read (its items stay unread until opened). */
  function readDigest(n: Notification) {
    if (!n.read_at) void markRead({ data: { id: n.id } }).then(refresh, () => undefined);
  }
  if (!member) return null;
  const items = query.data?.notifications ?? [];
  const failed = query.isError || query.data?.notifications === null;
  const unread = items.some((n) => !n.read_at);
  const entries = groupNotifications(items);
  return (
    <section
      data-testid="dashboard-notifications"
      aria-labelledby="dashboard-notifications-title"
      className="min-w-0 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="dashboard-notifications-title" className="text-xl font-semibold">
            {t("notifications.title")}
          </h2>
        </div>
        {unread && (
          <Button
            variant="outline"
            size="sm"
            data-testid="dashboard-notifications-mark-all"
            disabled={busy}
            onClick={() => void markAll()}
          >
            <CheckCheck />
            {t("notifications.markAll")}
          </Button>
        )}
      </div>
      {query.isLoading ? (
        <p className="mt-5 text-muted-foreground">{t("common.loading")}</p>
      ) : failed ? (
        <div role="alert" className="mt-5 space-y-2">
          <p className="text-destructive">{t("notifications.loadError")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p data-testid="dashboard-notifications-empty" className="mt-5 text-muted-foreground">
          {t("notifications.empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {entries.map((entry) => (
            <EntryItem
              key={entryId(entry)}
              entry={entry}
              onOpen={open}
              onExpandDigest={readDigest}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const entryId = (entry: NoticeEntry) =>
  entry.type === "group" ? `group:${entry.key}` : entry.notice.id;

function EntryItem({
  entry,
  onOpen,
  onExpandDigest,
}: {
  entry: NoticeEntry;
  onOpen: (n: Notification) => void;
  onExpandDigest: (n: Notification) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (entry.type === "single")
    return (
      <li className="min-w-0">
        <NoticeRow n={entry.notice} onOpen={onOpen} />
      </li>
    );
  const digest = entry.type === "digest";
  const count = digest ? (entry.notice.payload.count ?? entry.items.length) : entry.items.length;
  const newest = digest ? entry.notice : (entry.items[0] ?? null);
  const unread = entryUnread(entry);
  const toggle = () => {
    if (!open && digest) onExpandDigest(entry.notice);
    setOpen(!open);
  };
  return (
    <li
      className="min-w-0"
      data-testid={digest ? "dashboard-notification-digest" : "dashboard-notification-group"}
      data-kind={digest ? "daily_digest" : entry.kind}
      data-count={count}
      data-notification-id={digest ? entry.notice.id : undefined}
      data-unread={unread ? "true" : "false"}
    >
      <button
        type="button"
        data-testid={
          digest ? "dashboard-notification-digest-toggle" : "dashboard-notification-group-toggle"
        }
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        className="flex w-full min-w-0 items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={cn(
            "mt-2 size-2 shrink-0 rounded-full",
            unread ? "bg-primary" : "bg-transparent",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm [overflow-wrap:anywhere]", unread && "font-semibold")}>
            {digest ? notificationText(entry.notice, t) : groupText(entry, t)}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {newest && formatDate(newest.created_at, { dateStyle: "medium", timeStyle: "short" })}
            {unread && <span className="sr-only"> · {t("notifications.unread")}</span>}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("mt-1 size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
        <span className="sr-only">
          {open ? t("notifications.groups.hide") : t("notifications.groups.show", { count })}
        </span>
      </button>
      <ul id={listId} hidden={!open} className="ml-5 divide-y border-l pl-2">
        {open &&
          (digest
            ? entry.entries.map((inner) => (
                <EntryItem
                  key={entryId(inner)}
                  entry={inner}
                  onOpen={onOpen}
                  onExpandDigest={onExpandDigest}
                />
              ))
            : entry.items.map((n) => (
                <li key={n.id} className="min-w-0">
                  <NoticeRow n={n} onOpen={onOpen} />
                </li>
              )))}
      </ul>
    </li>
  );
}

function NoticeRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="dashboard-notification"
      data-notification-id={n.id}
      data-kind={n.kind}
      data-unread={n.read_at ? "false" : "true"}
      onClick={() => onOpen(n)}
      className="flex w-full min-w-0 items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          n.read_at ? "bg-transparent" : "bg-primary",
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn("block text-sm [overflow-wrap:anywhere]", !n.read_at && "font-semibold")}
        >
          {notificationText(n, t)}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {formatDate(n.created_at, { dateStyle: "medium", timeStyle: "short" })}
          {!n.read_at && <span className="sr-only"> · {t("notifications.unread")}</span>}
        </span>
      </span>
    </button>
  );
}
