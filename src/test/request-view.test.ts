import { describe, expect, it } from "vitest";
import { requestViewSearch, resolveRequestView } from "@/lib/request-view";
import { NAV_ITEMS } from "@/components/app/nav";

describe("unified Requests views", () => {
  it("volunteers always see their own requests", () => {
    expect(resolveRequestView("review", false, false, 4)).toBe("mine");
    expect(resolveRequestView("decided", false, false, 0)).toBe("mine");
  });
  it("managers default to review when there are pending items", () => {
    expect(resolveRequestView(undefined, true, false, 1)).toBe("review");
    expect(resolveRequestView(undefined, true, true, 1)).toBe("review");
  });
  it("Branch Managers can open their own requests even with pending reviews", () => {
    expect(resolveRequestView("mine", true, false, 3)).toBe("mine");
  });
  it("review-only reviewers (National Coordinators) cannot open the submission list", () => {
    expect(resolveRequestView("mine", true, true, 3)).toBe("review");
    expect(resolveRequestView("mine", true, true, 0)).toBe("decided");
  });
  it("Regional Directors can open their own (task and meeting) requests", () => {
    expect(resolveRequestView("mine", true, false, 3)).toBe("mine");
    expect(resolveRequestView(undefined, true, false, 0)).toBe("mine");
  });
  it("explicit review and decided links win over the default", () => {
    expect(resolveRequestView("decided", true, false, 5)).toBe("decided");
    expect(resolveRequestView("review", true, false, 0)).toBe("review");
  });
  it("validates the tab deep link", () => {
    expect(requestViewSearch({ tab: "mine" })).toEqual({ tab: "mine" });
    expect(requestViewSearch({ tab: "invalid" })).toEqual({});
  });
  it("offers exactly one Requests destination to followers, members and National Coordinators", () => {
    const items = NAV_ITEMS.filter((item) => item.to.includes("requests"));
    expect(items).toHaveLength(1);
    expect(items[0]?.to).toBe("/requests");
    expect(items[0]?.roles).toEqual([
      "follower",
      "volunteer",
      "branch_manager",
      "regional_director",
      "national_coordinator",
    ]); // NCs review the task and meeting requests sent to them
    expect(items[0]?.badge).toBe("requests");
  });
});
