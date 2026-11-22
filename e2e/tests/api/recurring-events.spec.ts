// A2r recurring events through the RPCs with each user's own token (RLS/permission checks are the real
// enforcement). Fresh users only; series are removed after each test.
import { test, expect } from "../../fixtures/roles";
import { clientAs, signIn } from "../../api/SupabaseClient";
import { requireEnv } from "../../setup/env";
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

  // The guard's bypass flag is the transaction-local GUC app.series_op, set only by series_op_begin/end inside
  // the series functions. A client must not be able to set it: not with set_config (pg_catalog is not exposed
  // by PostgREST), not by calling series_op_begin (EXECUTE revoked), not with HTTP headers (PostgREST puts
  // headers into the single JSON GUC request.headers, never into arbitrary GUC names).
  test("a client cannot set the guard flag (app.series_op) through PostgREST", async ({ freshUser, freshSeries }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const series = await freshSeries(manager, { label: "guard", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;BYDAY=TU;COUNT=2" });
    const token = (await signIn(manager.email)).access_token;
    const rpc = (fn: string, body: object, extra: Record<string, string> = {}) =>
      fetch(`${requireEnv("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: requireEnv("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra },
        body: JSON.stringify(body),
      });

    const setConfig = await rpc("set_config", { setting_name: "app.series_op", new_value: "on", is_local: false });
    expect(setConfig.status, "set_config is not exposed").toBe(404);
    const begin = await rpc("series_op_begin", {});
    expect([401, 403], "series_op_begin is not executable by clients").toContain(begin.status);

    // Spoofed headers: the manager still cannot delete the hidden media holder (only possible with the flag).
    const spoof = { "app.series_op": "on", "x-app-series-op": "on", Prefer: "tx=commit" };
    const holder = await rpc("delete_event", { _event: series.mediaEventId }, spoof);
    expect(holder.status).toBeGreaterThanOrEqual(400);
    expect(await holder.text()).toMatch(/Not allowed/);
    // ...and cancelling one occurrence with the same headers still marks it as an exception.
    const cancel = await rpc("cancel_event", { _event: series.firstEventId }, spoof);
    expect(cancel.status).toBeLessThan(300);
    expect((await occurrencesOf(series.mediaEventId)).find((o) => o.id === series.firstEventId)?.exception).toBe(true);
  });

  test("a volunteer cannot read draft, deleted or other-branch series rows through REST", async ({ freshUser, freshSeries }) => {
    const medwayManager = await freshUser({ role: "branch_manager" });
    const brightonManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const volunteer = await freshUser();
    const published = await freshSeries(medwayManager, { label: "visible", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;COUNT=2" });
    const draft = await freshSeries(medwayManager, { label: "draft", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;COUNT=2", status: "draft" });
    const deleted = await freshSeries(medwayManager, { label: "deleted", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;COUNT=2" });
    const otherBranch = await freshSeries(brightonManager, { label: "brighton", startLocal: "2027-01-05T18:00", rule: "FREQ=WEEKLY;COUNT=2" });
    const manager = await clientAs(medwayManager.email);
    const del = await manager.rpc("delete_series", { _event: deleted.firstEventId, _mode: "all" });
    expect(del.error).toBeNull();
    expect((await manager.rpc("finish_series_deletion", { _series: deleted.seriesId })).error).toBeNull();

    const as = await clientAs(volunteer.email);
    const read = async (id: string) => {
      const res = await as.from("event_series").select("id, rule, title").eq("id", id);
      expect(res.error).toBeNull();
      return res.data ?? [];
    };
    expect(await read(published.seriesId), "control: a published series of the volunteer's branch").toHaveLength(1);
    expect(await read(draft.seriesId), "draft series").toHaveLength(0);
    expect(await read(deleted.seriesId), "deleted series").toHaveLength(0);
    expect(await read(otherBranch.seriesId), "another branch's series").toHaveLength(0);
    // Listing everything returns no forbidden row either.
    const all = await as.from("event_series").select("id");
    expect((all.data ?? []).map((r: { id: string }) => r.id)).not.toEqual(expect.arrayContaining([draft.seriesId]));
    expect((all.data ?? []).map((r: { id: string }) => r.id)).not.toContain(deleted.seriesId);
    expect((all.data ?? []).map((r: { id: string }) => r.id)).not.toContain(otherBranch.seriesId);
    // Nor their occurrences or the hidden media holders.
    const events = await as.from("events").select("id").in("id", [draft.firstEventId, deleted.firstEventId, otherBranch.firstEventId, published.mediaEventId]);
    expect(events.data ?? []).toHaveLength(0);
  });
});
