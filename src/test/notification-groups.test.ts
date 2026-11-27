import { describe, expect, it } from "vitest";
import i18next, { type TFunction } from "i18next";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import type { Notification } from "@/lib/notifications";
import { entryNotices, groupNotifications } from "@/lib/notification-groups";
import { branchList, groupText, notificationText } from "@/lib/notification-text";
import { mobileNavFor, moreBadgeCount, navItemsFor } from "@/components/app/nav";

type Tree = { [key: string]: string | Tree };
const keys = (o: Tree, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`],
  );

async function translator(lang: "en" | "tr"): Promise<TFunction> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: lang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en as Tree },
      tr: { translation: tr as Tree },
    },
  });
  return instance.t;
}

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function notice(
  over: Partial<Notification> & { payload?: Notification["payload"] } = {},
): Notification {
  return {
    id: id(),
    kind: "task_status_changed",
    entity_type: "task",
    entity_id: id(),
    title: "Task",
    link: "/tasks",
    payload: {},
    created_at: `2026-11-24T10:${String(60 - seq).padStart(2, "0")}:00Z`,
    read_at: null,
    actor_name: "Ada",
    digest_id: null,
    ...over,
  };
}

describe("notification translations", () => {
  it("English and Turkish have the notice, group, waiting and settings texts", () => {
    for (const lang of [en, tr] as Tree[]) {
      const all = new Set(keys(lang));
      for (const k of [
        "notifications.kinds.review_waiting_one",
        "notifications.kinds.daily_digest_other",
        "notifications.settings.title",
        "dashboard.waiting.title",
      ])
        expect(all.has(k), k).toBe(true);
    }
  });
});

describe("groupNotifications", () => {
  it("groups ≥2 similar unread notices by kind, branch and status, keeps the rest as single lines", () => {
    const done = { status: "done", branch: "Medway" };
    const a = notice({ payload: done });
    const b = notice({ payload: { status: "blocked", branch: "Medway" } });
    const c = notice({ payload: done });
    const read = notice({ payload: done, read_at: "2026-11-24T11:00:00Z" });
    const other = notice({ payload: { status: "done", branch: "Brighton" } });
    const entries = groupNotifications([a, b, c, read, other]);
    expect(entries.map((e) => e.type)).toEqual(["group", "single", "single", "single"]);
    const group = entries[0]!;
    expect(group.type === "group" && group.items.map((n) => n.id)).toEqual([a.id, c.id]);
    expect(group.type === "group" && [group.kind, group.branch, group.status]).toEqual([
      "task_status_changed",
      "Medway",
      "done",
    ]);
  });

  it("puts a daily summary's items under it (grouped there too); items of a summary not in the list stay on top", () => {
    const digest = notice({ kind: "daily_digest", entity_type: "digest", payload: { count: 3 } });
    const i1 = notice({
      kind: "meeting_changed",
      digest_id: digest.id,
      payload: { branch: "Medway" },
    });
    const i2 = notice({
      kind: "meeting_changed",
      digest_id: digest.id,
      payload: { branch: "Medway" },
    });
    const i3 = notice({ kind: "task_note_added", digest_id: digest.id });
    const orphan = notice({ kind: "task_note_added", digest_id: id() });
    const now = notice({ kind: "task_assigned" });
    const entries = groupNotifications([now, digest, i1, i2, i3, orphan]);
    expect(entries.map((e) => e.type)).toEqual(["single", "digest", "single"]);
    const d = entries[1]!;
    if (d.type !== "digest") throw new Error("digest expected");
    expect(d.items.map((n) => n.id)).toEqual([i1.id, i2.id, i3.id]);
    expect(d.entries.map((e) => e.type)).toEqual(["group", "single"]);
    expect(entryNotices(d)).toHaveLength(4);
  });

  it("never groups the waiting-for-you notice or summaries", () => {
    const w1 = notice({ kind: "review_waiting", entity_type: "review", payload: { total: 2 } });
    const w2 = notice({ kind: "review_waiting", entity_type: "review", payload: { total: 2 } });
    expect(groupNotifications([w1, w2]).map((e) => e.type)).toEqual(["single", "single"]);
  });
});

describe("notification texts", () => {
  it("review_waiting with one and several requests and branches", async () => {
    const t = await translator("en");
    const text = (total: number, branches: string[]) =>
      notificationText(
        notice({ kind: "review_waiting", entity_type: "review", payload: { total, branches } }),
        t,
        "en",
      );
    expect(text(1, ["Medway"])).toBe("1 request from Medway is waiting for you");
    expect(text(3, ["Medway"])).toBe("3 requests from Medway are waiting for you");
    expect(text(3, ["Medway", "Brighton"])).toBe(
      "3 requests from Medway and Brighton are waiting for you",
    );
    expect(text(5, ["Medway", "Brighton", "Hastings"])).toBe(
      "5 requests from Medway, Brighton and Hastings are waiting for you",
    );
    expect(text(2, [])).toBe("2 requests are waiting for you");
    const trT = await translator("tr");
    expect(
      notificationText(
        notice({
          kind: "review_waiting",
          entity_type: "review",
          payload: { total: 3, branches: ["Medway", "Brighton"] },
        }),
        trT,
        "tr",
      ),
    ).toBe("Medway ve Brighton şubelerinden 3 talep sizi bekliyor");
  });

  it("daily summary and grouped lines", async () => {
    const t = await translator("en");
    expect(notificationText(notice({ kind: "daily_digest", payload: { count: 7 } }), t, "en")).toBe(
      "Your daily summary: 7 updates",
    );
    const items = [1, 2, 3, 4].map(() => notice({ payload: { status: "done", branch: "Medway" } }));
    const [group] = groupNotifications(items);
    if (group?.type !== "group") throw new Error("group expected");
    expect(groupText(group, t)).toBe("4 tasks in Medway were completed");
    const trT = await translator("tr");
    expect(groupText(group, trT)).toBe("Medway şubesinde 4 görev tamamlandı");
    const meetings = groupNotifications([
      notice({ kind: "meeting_invited" }),
      notice({ kind: "meeting_invited" }),
    ]);
    if (meetings[0]?.type !== "group") throw new Error("group expected");
    expect(groupText(meetings[0], t)).toBe("You were invited to 2 meetings");
    expect(branchList(["A", "B"], "tr")).toBe("A ve B");
  });
});

describe("mobile More badge", () => {
  it("sums the badges of the items under More", () => {
    const items = navItemsFor("branch_manager");
    const { more } = mobileNavFor("branch_manager", items);
    expect(more.some((i) => i.badge === "requests")).toBe(true);
    // Meetings is under More now: its invitations count towards the More badge with the requests.
    expect(moreBadgeCount(more, { requests: 3, tasks: 5, meetings: 2 })).toBe(5);
    expect(moreBadgeCount(items, { requests: 3, tasks: 5, meetings: 2 })).toBe(10);
    expect(moreBadgeCount(more, { requests: 0, tasks: 0, meetings: 0 })).toBe(0);
  });
});

describe("mobile bottom bar", () => {
  const bar = (role: Parameters<typeof mobileNavFor>[0]) => {
    const { primary, more } = mobileNavFor(role);
    return { primary: primary.map((i) => i.to), firstMore: more[0]?.to };
  };
  it("members: Dashboard · Calendar · Tasks · Media, Meetings first under More", () => {
    for (const role of ["volunteer", "trustee", "branch_manager", "regional_director"] as const)
      expect(bar(role)).toEqual({
        primary: ["/dashboard", "/calendar", "/tasks", "/media"],
        firstMore: "/meetings",
      });
  });
  it("National Coordinators keep their bar; followers get Media 4th", () => {
    expect(bar("national_coordinator").primary).toEqual([
      "/dashboard",
      "/calendar",
      "/tasks",
      "/meetings",
    ]);
    // Followers see the Media of the branches they follow (read-only): Media in the 4th slot.
    expect(bar("follower").primary).toEqual(["/dashboard", "/calendar", "/requests", "/media"]);
  });
});
