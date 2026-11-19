import { describe, expect, it } from "vitest";
import { canEditRoleOrBranch, filterMembers, isLastBranchManager } from "@/lib/member-rules";

const volunteer = { id: "v", full_name: "Mehmet Baran", email: "mehmet@example.org", status: "pending" as const, branch_id: "medway", roles: ["volunteer" as const] };
const manager = { ...volunteer, id: "m", status: "active" as const, roles: ["branch_manager" as const] };
describe("Director-only role and branch actions", () => {
  it("allows active regional directors", () => expect(canEditRoleOrBranch("active", ["regional_director"])).toBe(true));
  it("rejects pending directors", () => expect(canEditRoleOrBranch("pending", ["regional_director"])).toBe(false));
  it("rejects inactive directors", () => expect(canEditRoleOrBranch("inactive", ["regional_director"])).toBe(false));
  it("rejects branch managers", () => expect(canEditRoleOrBranch("active", ["branch_manager"])).toBe(false));
  it("rejects volunteers", () => expect(canEditRoleOrBranch("active", ["volunteer"])).toBe(false));
});
describe("Last branch manager warning", () => {
  it("warns for the last manager", () => expect(isLastBranchManager(manager, [volunteer, manager])).toBe(true));
  it("does not warn when another manager is in the same branch", () => expect(isLastBranchManager(manager, [manager, { ...manager, id: "second" }])).toBe(false));
  it("still warns when the other manager is in a different branch", () => expect(isLastBranchManager(manager, [manager, { ...manager, id: "second", branch_id: "london" }])).toBe(true));
});
describe("Member filters", () => {
  const all = { search: "", status: "all", role: "all", branch: "all" };
  it("filters status", () => expect(filterMembers([volunteer, manager], { ...all, status: "pending" }).map((m) => m.id)).toEqual(["v"]));
  it("filters role", () => expect(filterMembers([volunteer, manager], { ...all, role: "branch_manager" }).map((m) => m.id)).toEqual(["m"]));
  it("filters branch", () => expect(filterMembers([volunteer, { ...manager, branch_id: "london" }], { ...all, branch: "medway" }).map((m) => m.id)).toEqual(["v"]));
  it("searches names case-insensitively", () => expect(filterMembers([volunteer], { ...all, search: "MEHMET" })).toEqual([volunteer]));
  it("searches email", () => expect(filterMembers([volunteer], { ...all, search: "example.org" })).toEqual([volunteer]));
  it("combines filters", () => expect(filterMembers([volunteer, manager], { search: "Mehmet", status: "pending", role: "branch_manager", branch: "medway" })).toEqual([]));
});
import { deleteBlockReason, deletionDaysRemaining } from "@/lib/member-rules";
describe("deletion rules", () => {
  it("only inactive users can be deleted directly", () => {
    expect(deleteBlockReason("active")).toBe("Deactivate the user first");
    expect(deleteBlockReason("pending")).toBe("Deactivate the user first");
    expect(deleteBlockReason("inactive")).toBeNull();
  });
  it("deletion requests do not need the user to be inactive", () => {
    expect(deleteBlockReason("active", true)).toBeNull();
  });
  it("counts days remaining out of 30", () => {
    expect(deletionDaysRemaining("2026-11-01T00:00:00Z", new Date("2026-11-11T12:00:00Z"))).toBe(20);
    expect(deletionDaysRemaining("2026-09-01T00:00:00Z", new Date("2026-11-11T00:00:00Z"))).toBe(0);
  });
});
