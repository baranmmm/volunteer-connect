// A3 revision: external requests, reviewer editing and attachments, through the RPCs and Storage with each user's
// own token (RLS and the bucket rules are the enforcement). Fresh users only; requests and files are removed after.
import { test, expect } from "../../fixtures/roles";
import { adminClient, clientAs } from "../../api/SupabaseClient";
import {
  attachAs, deleteRequests, externalInput, REQUEST_TITLE_PREFIX, requestInput, requestRow, rpcAs, storedObject, submitRequestAs, TINY_PDF, TINY_PNG,
} from "../../api/eventRequests";

const title = (label: string) => `${REQUEST_TITLE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)} ${label}`;
const submitExternal = async (email: string, t: string, extra: Record<string, unknown> = {}) => {
  const { data, error } = await rpcAs<string>(email, "submit_event_request", { p: externalInput(t, extra) });
  if (error) throw new Error(error);
  return data;
};

test.describe("Event request types API", () => {
  test("external requests with and without files; organiser, source and https rules", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const reject = async (extra: Record<string, unknown>) => (await rpcAs(volunteer.email, "submit_event_request", { p: externalInput(title("bad"), extra) })).error;
    expect(await reject({ organizer_name: "" })).toBe("Organiser is required");
    expect(await reject({ source: "radio" })).toBe("Invalid request source");
    expect(await reject({ source_url: "http://example.org/x" })).toBe("Source link must use https");
    const plain = await submitExternal(volunteer.email, title("no files"), { expected_attendees: 30 });
    expect(await requestRow(plain)).toMatchObject({ status: "submitted", scope: "branch" });
    const { data: row } = await adminClient().from("event_requests").select("request_type, organizer_name, expected_attendees").eq("id", plain).single();
    expect(row).toEqual({ request_type: "external", organizer_name: "E2E Community Centre", expected_attendees: null });

    const withFiles = await submitExternal(volunteer.email, title("files"));
    const png = await attachAs(volunteer.email, withFiles, { kind: "image", ext: "png", body: TINY_PNG, mime: "image/png", name: "leaflet.png" });
    expect(png.error).toBeNull();
    expect(png.path).toMatch(new RegExp(`^${withFiles}/[0-9a-f-]{36}\\.png$`));
    expect((await attachAs(volunteer.email, withFiles, { kind: "pdf", ext: "pdf", body: TINY_PDF, mime: "application/pdf" })).error).toBeNull();
    expect(await storedObject("event-request-files", png.path!)).toBe(true);
    const listed = await rpcAs<{ uploaded: boolean }[]>(volunteer.email, "list_event_request_media", { p_request_id: withFiles });
    expect(listed.data.map((m) => m.uploaded)).toEqual([true, true]);
  });

  test("file rules: type and size refused by the RPC and the bucket; 3 files at most; no free paths", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const id = await submitExternal(volunteer.email, title("file rules"));
    expect((await attachAs(volunteer.email, id, { kind: "image", ext: "docx", body: TINY_PNG, mime: "image/png" })).error).toBe("Invalid request file");
    // Reserved as .png but sent as text: the bucket's MIME list refuses it.
    const wrongMime = await attachAs(volunteer.email, id, { kind: "image", ext: "png", body: Buffer.from("not an image"), mime: "text/plain" });
    expect(wrongMime.error).toMatch(/mime|type|not supported|invalid/i);
    const tooBig = await attachAs(volunteer.email, id, { kind: "pdf", ext: "pdf", body: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20), mime: "application/pdf" });
    expect(tooBig.error).toMatch(/size|large|exceed|payload/i);
    // An upload to a path the server did not reserve is refused by Storage RLS.
    const free = await (await clientAs(volunteer.email)).storage.from("event-request-files").upload(`${id}/${crypto.randomUUID()}.png`, TINY_PNG, { contentType: "image/png" });
    expect(free.error).not.toBeNull();
    const { count } = await adminClient().from("event_request_media").select("id", { count: "exact", head: true }).eq("request_id", id);
    expect(count).toBe(2); // the two failed uploads keep their reservations until the client removes them
    expect((await attachAs(volunteer.email, id, { kind: "image", ext: "png", body: TINY_PNG, mime: "image/png" })).error).toBeNull();
    expect((await attachAs(volunteer.email, id, { kind: "image", ext: "png", body: TINY_PNG, mime: "image/png" })).error).toBe("Maximum 3 files per request");
  });

  test("only the requester and the request's reviewers can get a signed link to an attachment", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const other = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const otherManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const id = await submitExternal(volunteer.email, title("signed"));
    const { path } = await attachAs(volunteer.email, id, { kind: "pdf", ext: "pdf", body: TINY_PDF, mime: "application/pdf" });
    for (const allowed of [volunteer, manager]) {
      const signed = await (await clientAs(allowed.email)).storage.from("event-request-files").createSignedUrl(path!, 300);
      expect(signed.error, allowed.email).toBeNull();
    }
    for (const denied of [other, otherManager]) {
      const signed = await (await clientAs(denied.email)).storage.from("event-request-files").createSignedUrl(path!, 300);
      expect(signed.error, denied.email).not.toBeNull();
      expect((await (await clientAs(denied.email)).storage.from("event-request-files").download(path!)).error).not.toBeNull();
      expect((await rpcAs(denied.email, "list_event_request_media", { p_request_id: id })).error).toBe("Request not found");
    }
    expect((await (await clientAs(volunteer.email)).from("event_request_media").select("id")).error?.message).toMatch(/permission denied/);
  });

  test("reviewer editing: completes publish fields, locks the requester out, then approval publishes with the files", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const otherManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const t = title("publish");
    const id = await submitExternal(volunteer.email, t);
    const { path } = await attachAs(volunteer.email, id, { kind: "image", ext: "png", body: TINY_PNG, mime: "image/png" });
    expect((await rpcAs(manager.email, "approve_event_request", { p_id: id })).error).toBe("Required publish fields missing");
    expect((await rpcAs(otherManager.email, "manager_update_event_request", { p_id: id, p: externalInput(t) })).error).toBe("Request not found");
    for (const change of [{ scope: "region" }, { request_type: "proposal" }, { status: "approved" }, { requester_id: manager.id }])
      expect((await rpcAs(manager.email, "manager_update_event_request", { p_id: id, p: externalInput(t, change) })).error, JSON.stringify(change)).toBe("Request scope and type cannot be changed");
    const edited = externalInput(`${t} edited`, { category: "community", location_text: "E2E Hall" });
    expect((await rpcAs(manager.email, "manager_update_event_request", { p_id: id, p: edited })).error).toBeNull();
    expect(await requestRow(id)).toMatchObject({ status: "under_review", reviewer_id: manager.id });
    expect((await rpcAs(volunteer.email, "update_event_request", { p_id: id, p: externalInput(t) })).error).toBe("Request can no longer be changed");
    const mine = await rpcAs<{ edited_by_manager: boolean }>(volunteer.email, "get_event_request", { p_id: id });
    expect(mine.data.edited_by_manager).toBe(true);

    // Approval with the reviewer's token, then the copy exactly as the server function does it.
    const approved = await rpcAs<{ event_id: string; published: boolean; copies: { from: string; to: string }[] }>(manager.email, "approve_event_request", { p_id: id });
    expect(approved.error).toBeNull();
    expect(approved.data.published).toBe(true);
    expect(approved.data.copies).toEqual([expect.objectContaining({ from: path })]);
    const reviewer = await clientAs(manager.email);
    const signed = await reviewer.storage.from("event-request-files").createSignedUrl(path!, 60);
    expect(signed.error).toBeNull();
    const file = await (await fetch(signed.data!.signedUrl)).arrayBuffer();
    expect((await reviewer.storage.from("event-media").upload(approved.data.copies[0]!.to, file, { contentType: "image/png" })).error).toBeNull();
    const { data: event } = await adminClient().from("events").select("status, is_external, organizer, title, category, location").eq("id", approved.data.event_id).single();
    expect(event).toEqual({ status: "published", is_external: true, organizer: "E2E Community Centre", title: `${t} edited`, category: "community", location: "E2E Hall" });
    expect(await storedObject("event-media", approved.data.copies[0]!.to)).toBe(true);
    expect((await rpcAs(manager.email, "manager_update_event_request", { p_id: id, p: edited })).error).toBe("Request already decided");
  });

  test("duplicates warn on the same day with a similar title; proposals still become drafts; declined requests stay closed", async ({ freshUser, freshEvent }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const token = `dup${Date.now()}`;
    const existing = await freshEvent(manager, { label: `Big ${token} night`, status: "published", startInMinutes: 7 * 24 * 60 });
    const { data: ev } = await adminClient().from("events").select("start_at, end_at").eq("id", existing.id).single();
    // The request title is contained in the event title (case-insensitive).
    const id = await submitExternal(volunteer.email, token.toUpperCase(), { proposed_start: ev!.start_at, proposed_end: ev!.end_at });
    const dups = await rpcAs<{ id: string }[]>(manager.email, "get_event_request_duplicates", { p_id: id });
    expect(dups.data.map((d) => d.id)).toContain(existing.id);
    expect((await rpcAs(volunteer.email, "get_event_request_duplicates", { p_id: id })).error).toBe("Request not found");

    const proposal = await submitRequestAs(volunteer.email, title("proposal"));
    const approved = await rpcAs<{ event_id: string; published: boolean }>(manager.email, "approve_event_request", { p_id: proposal });
    expect(approved.data.published).toBe(false);
    const { data: draft } = await adminClient().from("events").select("status, is_external").eq("id", approved.data.event_id).single();
    expect(draft).toEqual({ status: "draft", is_external: false });

    const declined = await submitExternal(volunteer.email, title("declined"));
    expect((await rpcAs(manager.email, "decline_event_request", { p_id: declined, p_reason: "Not for our calendar." })).error).toBeNull();
    expect((await rpcAs(manager.email, "manager_update_event_request", { p_id: declined, p: externalInput(title("x")) })).error).toBe("Request already decided");
    expect((await rpcAs(manager.email, "approve_event_request", { p_id: declined, p_overrides: {} })).error).toMatch(/Could not find the function|does not exist/);
    expect((await rpcAs(volunteer.email, "update_event_request", { p_id: proposal, p: requestInput(title("late")) })).error).toBe("Request can no longer be changed");
  });

  test("purge chain: attachments are removed from Storage before the request row", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const id = await submitExternal(volunteer.email, title("purge"));
    const { path } = await attachAs(volunteer.email, id, { kind: "pdf", ext: "pdf", body: TINY_PDF, mime: "application/pdf" });
    try {
      expect((await rpcAs(volunteer.email, "delete_event_request", { p_id: id })).error).toBeNull();
      const prepared = await rpcAs<{ deleted: boolean; paths: string[] }>(manager.email, "permanent_delete_item", { _type: "event_request", _id: id, _confirmation: "DELETE" });
      expect(prepared.data).toMatchObject({ deleted: false, paths: [path] });
      expect((await rpcAs(manager.email, "restore_item", { _type: "event_request", _id: id })).error).toBe("Item cannot be restored");
      expect((await rpcAs(manager.email, "purge_event_request", { _id: id, _finalize: true })).error).toMatch(/permission denied/);
      // The server's purgeEventRequest: service role, Storage first, then the row.
      expect((await adminClient().rpc("purge_event_request", { _id: id, _finalize: true })).error?.message).toBe("Event files still exist");
      expect((await adminClient().storage.from("event-request-files").remove([path!])).error).toBeNull();
      expect((await adminClient().rpc("purge_event_request", { _id: id, _finalize: true })).error).toBeNull();
      expect(await requestRow(id)).toBeNull();
      expect(await storedObject("event-request-files", path!)).toBe(false);
    } finally {
      await deleteRequests([id]);
    }
  });
});
