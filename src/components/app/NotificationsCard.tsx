import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { formatDate } from "@/lib/i18n";
import type { Notification } from "@/lib/notifications";
import { groupText, notificationText } from "@/lib/notification-text";
import { entryUnread, groupNotifications, type NoticeEntry } from "@/lib/notification-groups";
import { cn } from "@/lib/utils";

// The grouped notice list of the header bell and the Notifications page (actions: src/lib/use-notification-actions.ts).

/** Similar unread notices are one expandable line ("4 tasks in Medway were completed"); a daily summary holds its items. */
export function NotificationEntries({
  items,
  onOpen,
  onExpandDigest,
  className,
}: {
  items: Notification[];
  onOpen: (n: Notification) => void;
  onExpandDigest: (n: Notification) => void;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y", className)}>
      {groupNotifications(items).map((entry) => (
        <EntryItem
          key={entryId(entry)}
          entry={entry}
          onOpen={onOpen}
          onExpandDigest={onExpandDigest}
        />
      ))}
    </ul>
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
