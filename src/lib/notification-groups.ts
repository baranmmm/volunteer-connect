import type { Notification } from "@/lib/notifications";

// Less noise on the dashboard: similar unread notices become one expandable line, and the items of a daily summary
// sit under that summary. Pure functions (Vitest: src/test/notification-groups.test.ts).

/** Kinds that are never grouped: they already stand for many things. */
const UNGROUPED = new Set(["review_waiting", "daily_digest"]);
/** A group needs at least this many similar unread notices. */
export const GROUP_MIN = 2;

export type NoticeEntry =
  | { type: "single"; notice: Notification }
  | {
      type: "group";
      /** kind|branch|status: stable id of the group in this list. */
      key: string;
      kind: string;
      branch?: string | undefined;
      status?: string | undefined;
      items: Notification[];
    }
  | { type: "digest"; notice: Notification; entries: NoticeEntry[]; items: Notification[] };

const groupKey = (n: Notification) =>
  [n.kind, n.payload.branch ?? "", n.payload.status ?? ""].join("|");

/** Groups unread notices by kind + branch + status (≥ GROUP_MIN items), in the list's order (newest first). */
function group(list: Notification[]): NoticeEntry[] {
  const buckets = new Map<string, Notification[]>();
  for (const n of list) {
    if (n.read_at || UNGROUPED.has(n.kind)) continue;
    const key = groupKey(n);
    buckets.set(key, [...(buckets.get(key) ?? []), n]);
  }
  const placed = new Set<string>();
  const out: NoticeEntry[] = [];
  for (const n of list) {
    const key = groupKey(n);
    const bucket = !n.read_at && !UNGROUPED.has(n.kind) ? buckets.get(key) : undefined;
    if (!bucket || bucket.length < GROUP_MIN) {
      out.push({ type: "single", notice: n });
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    out.push({
      type: "group",
      key,
      kind: n.kind,
      branch: n.payload.branch,
      status: n.payload.status,
      items: bucket,
    });
  }
  return out;
}

/**
 * The dashboard list: daily summaries hold their items (notices whose digest_id is a summary in the list), and the
 * rest is grouped. An item whose summary is not in the list (older than the list) stays at the top level.
 */
export function groupNotifications(list: Notification[]): NoticeEntry[] {
  const digests = new Set(list.filter((n) => n.kind === "daily_digest").map((n) => n.id));
  const inDigest = (n: Notification) => !!n.digest_id && digests.has(n.digest_id);
  return group(list.filter((n) => !inDigest(n))).map((entry) => {
    if (entry.type !== "single" || entry.notice.kind !== "daily_digest") return entry;
    const items = list.filter((n) => n.digest_id === entry.notice.id);
    return { type: "digest", notice: entry.notice, items, entries: group(items) };
  });
}

/** Every notice an entry stands for (the line itself and what it holds). */
export function entryNotices(entry: NoticeEntry): Notification[] {
  if (entry.type === "single") return [entry.notice];
  if (entry.type === "group") return entry.items;
  return [entry.notice, ...entry.items];
}

/** Whether an entry has anything unread (bold line, "Mark all as read"). */
export const entryUnread = (entry: NoticeEntry) => entryNotices(entry).some((n) => !n.read_at);
