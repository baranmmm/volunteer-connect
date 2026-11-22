// A2r recurring events through the RPCs with each user's own token (RLS/permission checks are the real
// enforcement). Fresh users only; series are removed after each test.
import { test, expect } from "../../fixtures/roles";
import { clientAs } from "../../api/SupabaseClient";
import { createSeriesAs, londonIso, occurrencesOf } from "../../api/events";

test.describe("Recurring events API", () => {
  test("weekly 18:00 stays 18:00 London across the 28 March 2027 clock change", async ({ freshUser, freshSeries }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const series = await freshSeries(manager, { label: "dst", startLocal: "2027-03-16T18:00", rule: "FREQ=WEEKLY;BYDAY=TU;COUNT=4" });
    const occ = await occurrencesOf(series.mediaEventId);
    expect(occ.map((o) => o.londonStart)).toEqual(["Tue, 2027-03-16, 18:00", "Tue, 2027-03-23, 18:00", "Tue, 2027-03-30, 18:00", "Tue, 2027-04-06, 18:00"]);
    expect(occ.map((o) => o.utcStart)).toEqual(["18:00", "18:00", "17:00", "17:00"]); // GMT, then BST
  });

  test("a volunteer cannot create, edit or delete a series", async ({ freshUser, freshSeries }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const series = await freshSeries(manager, { label: "volunteer api", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;BYDAY=TU;COUNT=8" });
    const as = await clientAs(volunteer.email);
    const start = londonIso("2027-01-12T18:00"), end = londonIso("2027-01-12T19:30");
    const data = { title: "Hack", description: "", location: "X", location_type: "in_person", online_url: null, organizer: "E2E", category: "dialogue", all_day: false, start_date: null, end_date: null, start_at: start, end_at: end, capacity: null, scope: "branch", branch_id: volunteer.branchId, status: "published" };

    expect((await as.rpc("create_series", { _data: data, _rule: "FREQ=WEEKLY;COUNT=2" })).error, "create_series").not.toBeNull();
    for (const mode of ["this", "following", "all"]) {
      expect((await as.rpc("update_series_event", { _event: series.firstEventId, _mode: mode, _data: data })).error, `update ${mode}`).not.toBeNull();
    }
    for (const mode of ["following", "all"]) {
      expect((await as.rpc("delete_series", { _event: series.firstEventId, _mode: mode })).error, `delete ${mode}`).not.toBeNull();
    }
    expect((await as.rpc("delete_event", { _event: series.firstEventId })).error, "delete_event").not.toBeNull();
    const after = await occurrencesOf(series.mediaEventId);
    expect(after).toHaveLength(8);
    expect(after.every((o) => o.title === series.title)).toBe(true);
  });

  test("a branch manager cannot create a series for another branch or change another branch's series", async ({ freshUser, freshSeries, seed }) => {
    const medway = await freshUser({ role: "branch_manager" });
    const brighton = await freshUser({ role: "branch_manager", branch: "Brighton" });
    await expect(createSeriesAs(medway.email, { title: "E2E Event cross-branch", branchId: seed.branches.Brighton, startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;COUNT=2" })).rejects.toThrow(/Not allowed/);

    const series = await freshSeries(medway, { label: "medway only", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;BYDAY=TU;COUNT=4" });
    const as = await clientAs(brighton.email);
    expect((await as.rpc("delete_series", { _event: series.firstEventId, _mode: "all" })).error).not.toBeNull();
    expect((await occurrencesOf(series.mediaEventId))).toHaveLength(4);
  });
});
