import { describe, expect, it } from "vitest";
import { publicNavItems, publicNavPage } from "@/lib/public-nav";

describe("public top bar", () => {
  it("knows its own pages from the address", () => {
    expect(publicNavPage("/")).toBe("join");
    expect(publicNavPage("/join")).toBe("join");
    expect(publicNavPage("/sign-in")).toBe("sign-in");
    expect(publicNavPage("/sign-in/")).toBe("sign-in");
    expect(publicNavPage("/events")).toBe("events");
    expect(publicNavPage("/events/")).toBe("events");
  });
  it("other public pages (event details, privacy, email links, /auth) have no current item", () => {
    for (const path of [
      "/events/0b6c",
      "/privacy",
      "/privacy/attendees",
      "/e/confirm",
      "/auth",
      "/reset-password",
    ])
      expect(publicNavPage(path)).toBeNull();
  });
  it("hides Join on the join page and Sign in on the sign-in page, marks Events on /events", () => {
    expect(publicNavItems("join")).toEqual({
      eventsCurrent: false,
      showSignIn: true,
      showJoin: false,
    });
    expect(publicNavItems("sign-in")).toEqual({
      eventsCurrent: false,
      showSignIn: false,
      showJoin: true,
    });
    expect(publicNavItems("events")).toEqual({
      eventsCurrent: true,
      showSignIn: true,
      showJoin: true,
    });
    expect(publicNavItems(null)).toEqual({
      eventsCurrent: false,
      showSignIn: true,
      showJoin: true,
    });
  });
});
