import { describe, expect, it } from "vitest";
import {
  branchIdsFromSlugs,
  branchSlug,
  publicEventsIcs,
  type PublicEvent,
} from "@/lib/public-events";
import { inFollowedBranches } from "@/lib/followed-branches";
import { isFollowerRoles, primaryRole } from "@/lib/roles";
import { forbiddenItem, navItemsFor } from "@/components/app/nav";

const event: PublicEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Open iftar, Medway",
  description: "All welcome",
  status: "published",
  scope: "branch",
  all_day: false,
  start_at: "2027-03-01T18:00:00Z",
  end_at: "2027-03-01T20:00:00Z",
  start_date: null,
  end_date: null,
  branch_id: "22222222-2222-4222-8222-222222222222",
  branch: "Medway",
  region_id: "33333333-3333-4333-8333-333333333333",
  region: "South of England",
  category: "dinner",
  location: "Community Hall",
  is_online: false,
  organizer: null,
  registration: "open",
  has_image: false,
};

describe("public events", () => {
  it("branch slugs in URLs map back to branch ids", () => {
    expect(branchSlug("Kent & Medway")).toBe("kent-medway");
    const branches = [
      { id: "a", name: "Medway" },
      { id: "b", name: "Brighton" },
      { id: "c", name: "Kent & Medway" },
    ];
    expect(branchIdsFromSlugs("medway,kent-medway,unknown", branches)).toEqual(["a", "c"]);
    expect(branchIdsFromSlugs("", branches)).toEqual([]);
  });

  it("the ICS feed: one VEVENT per event, UID = id, cancelled as CANCELLED, the detail URL, never an online link", () => {
    const online = {
      ...event,
      id: "44444444-4444-4444-8444-444444444444",
      is_online: true,
      location: null,
    };
    const cancelled = {
      ...event,
      id: "55555555-5555-4555-8555-555555555555",
      status: "cancelled" as const,
      all_day: true,
      start_at: null,
      end_at: null,
      start_date: "2027-03-05",
      end_date: "2027-03-06",
    };
    const ics = publicEventsIcs(
      [event, online, cancelled],
      "https://hub.example.org",
      "Events",
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain(`UID:${event.id}@dialoguesociety.org`);
    expect(ics).toContain("DTSTART:20270301T180000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270305\r\nDTEND;VALUE=DATE:20270307");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain(`URL:https://hub.example.org/events/${event.id}`);
    expect(ics).toContain("Online event");
    expect(ics).not.toMatch(/https:\/\/(?!hub\.example\.org)/);
    for (const line of ics.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("roles and menus", () => {
  it("ranks follower < volunteer < branch manager < regional director < national coordinator", () => {
    expect(primaryRole([])).toBe("follower");
    expect(primaryRole(["follower"])).toBe("follower");
    expect(primaryRole(["volunteer", "branch_manager"])).toBe("branch_manager");
    expect(primaryRole(["national_coordinator"])).toBe("national_coordinator");
    expect(isFollowerRoles(["follower"])).toBe(true);
    expect(isFollowerRoles(["volunteer"])).toBe(false);
  });

  it("followers see no member pages (Media of the branches they follow, read-only); NCs get Regions; Donate is for everyone", () => {
    const follower = navItemsFor("follower").map((i) => i.testId);
    expect(follower).toEqual([
      "nav-dashboard",
      "nav-calendar",
      "nav-media",
      "nav-requests",
      "nav-profile",
      "nav-donate",
    ]);
    for (const path of [
      "/tasks",
      "/meetings",
      "/training",
      "/users",
      "/recycle-bin",
      "/regions",
      "/users/abc",
    ]) {
      expect(forbiddenItem("follower", path), path).toBeTruthy();
    }
    expect(forbiddenItem("follower", "/requests")).toBeFalsy();
    expect(navItemsFor("national_coordinator").map((i) => i.testId)).toContain("nav-regions");
    // National Coordinators open Requests to decide task and meeting requests sent to them.
    expect(forbiddenItem("national_coordinator", "/requests")).toBeFalsy();
    expect(
      navItemsFor("follower").find((i) => i.badge === "tasks" || i.badge === "meetings"),
    ).toBeUndefined();
    // Regional Directors see their own region on Regions & branches (the map); Branch Managers do not.
    expect(forbiddenItem("regional_director", "/regions")).toBeFalsy();
    expect(forbiddenItem("branch_manager", "/regions")).toBeTruthy();
    expect(navItemsFor("volunteer").find((i) => i.testId === "nav-donate")?.href).toBe(
      "https://www.dialoguesociety.org/donation/",
    );
  });

  it("the calendar's followed-branches view keeps members events, filters public ones by followed branch/region", () => {
    const followed = [{ branch_id: "b1", name: "One", region_id: "r1", own: false }];
    expect(
      inFollowedBranches(
        { audience: "members", scope: "branch", branch_id: "b9", region_id: "r9" },
        followed,
      ),
    ).toBe(true);
    expect(
      inFollowedBranches(
        { audience: "public", scope: "branch", branch_id: "b1", region_id: "r1" },
        followed,
      ),
    ).toBe(true);
    expect(
      inFollowedBranches(
        { audience: "public", scope: "branch", branch_id: "b2", region_id: "r1" },
        followed,
      ),
    ).toBe(false);
    expect(
      inFollowedBranches(
        { audience: "public", scope: "region", branch_id: null, region_id: "r1" },
        followed,
      ),
    ).toBe(true);
    expect(
      inFollowedBranches(
        { audience: "public", scope: "national", branch_id: null, region_id: null },
        followed,
      ),
    ).toBe(true);
  });
});
