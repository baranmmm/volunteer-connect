import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NOTICE_LINK_DAYS,
  noticeUnsubscribeLinks,
  signLinkToken,
  signNoticeToken,
  verifyLinkToken,
  verifyNoticeToken,
} from "@/lib/email/links.server";
import { validateTokenSearch } from "@/components/public/link-search";

// Signed "stop these emails" links in member notice emails: one member, one notice type, valid for NOTICE_LINK_DAYS
// days; never usable for another member, type or link purpose.
const USER = "12345678-1234-4123-8123-123456789abc";
const OTHER = "87654321-4321-4321-8321-cba987654321";
const now = new Date("2027-01-15T08:05:00Z");
const later = (days: number) => new Date(now.getTime() + days * 86400000);

let saved: string | undefined;
beforeEach(() => {
  saved = process.env["EMAIL_LINK_SECRET"];
  process.env["EMAIL_LINK_SECRET"] = "test-secret";
});
afterEach(() => {
  if (saved === undefined) delete process.env["EMAIL_LINK_SECRET"];
  else process.env["EMAIL_LINK_SECRET"] = saved;
});

describe("notice unsubscribe tokens", () => {
  it("verify for the same member and type until they expire", async () => {
    const token = await signNoticeToken(USER, "meeting", now);
    expect(token.length).toBeLessThanOrEqual(100);
    expect(validateTokenSearch({ t: token })).toEqual({ t: token });
    expect(await verifyNoticeToken(token, now)).toEqual({ user: USER, type: "meeting" });
    expect(await verifyNoticeToken(token, later(NOTICE_LINK_DAYS))).toEqual({
      user: USER,
      type: "meeting",
    });
    expect(await verifyNoticeToken(token, later(NOTICE_LINK_DAYS + 1))).toBeNull();
  });

  it("reject tampered tokens: another member, type, expiry, signature, or another secret", async () => {
    const token = await signNoticeToken(USER, "task_assigned", now);
    const [user, type, expires, sig] = token.split(".");
    expect(await verifyNoticeToken([OTHER, type, expires, sig].join("."), now)).toBeNull();
    expect(await verifyNoticeToken([user, "review", expires, sig].join("."), now)).toBeNull();
    expect(
      await verifyNoticeToken([user, type, String(Number(expires) + 30), sig].join("."), now),
    ).toBeNull();
    expect(
      await verifyNoticeToken(
        [user, type, expires, `${sig!.slice(0, -1)}${sig!.endsWith("A") ? "B" : "A"}`].join("."),
        now,
      ),
    ).toBeNull();
    expect(await verifyNoticeToken([user, "everything", expires, sig].join("."), now)).toBeNull();
    expect(await verifyNoticeToken(`${token}.x`, now)).toBeNull();
    expect(await verifyNoticeToken("", now)).toBeNull();
    process.env["EMAIL_LINK_SECRET"] = "another-secret";
    expect(await verifyNoticeToken(token, now)).toBeNull();
  });

  it("never cross over with the other email links", async () => {
    const subscriber = await signLinkToken("subscriber-unsubscribe", USER);
    expect(await verifyNoticeToken(subscriber, now)).toBeNull();
    const notice = await signNoticeToken(USER, "meeting", now);
    expect(await verifyLinkToken("subscriber-unsubscribe", notice)).toBeNull();
  });

  it("the page and one-click links carry the same token", async () => {
    const links = await noticeUnsubscribeLinks(USER, "review", "https://hub.example.org", now);
    const page = new URL(links.page);
    const oneClick = new URL(links.oneClick);
    expect(page.pathname).toBe("/e/notices");
    expect(oneClick.pathname).toBe("/api/public/notice-unsubscribe");
    expect(page.searchParams.get("t")).toBe(oneClick.searchParams.get("t"));
    expect(await verifyNoticeToken(page.searchParams.get("t"), now)).toEqual({
      user: USER,
      type: "review",
    });
  });
});
