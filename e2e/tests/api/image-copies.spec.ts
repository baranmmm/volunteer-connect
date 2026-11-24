// Resized image copies (.w640/.w1280.webp next to an event image): the manager stores them through Storage RLS, the
// flag needs both objects, and moving an event to the Recycle Bin and back takes the copies along (the same
// prepare → move → finalize steps as the deleteEvent/restoreEvent server functions).
import { test, expect } from "../../fixtures/roles";
import { adminClient, clientAs } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX, addCoverImageAs, createEventAs, deleteEvents } from "../../api/events";
import { copyNames, storedEventObjects } from "../../api/images";

const WEBP = Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00", "latin1");

async function move(paths: string[], restoring: boolean) {
  const bucket = adminClient().storage.from("event-media");
  for (const path of paths) {
    const { error } = await bucket.move(restoring ? `deleted/${path}` : path, restoring ? path : `deleted/${path}`);
    expect(error, `move ${path}`).toBeNull();
  }
}

test.describe("Image copies", () => {
  test("a manager stores both copies, flags the image, and archive → restore keeps the copies", async ({ freshUser }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const db = await clientAs(manager.email);
    const id = await createEventAs(manager.email, { title: `${EVENT_TITLE_PREFIX}copies ${Date.now()}`, branchId: manager.branchId!, status: "draft" });
    try {
      const { mediaId, path } = await addCoverImageAs(manager.email, id);
      const name = path.split("/").pop()!;
      const [w640, w1280] = copyNames(name).map((n) => `${id}/${n}`) as [string, string];

      // The flag needs both copies in Storage.
      const early = await db.rpc("set_event_media_variants", { p_media: mediaId });
      expect(early.error?.message).toContain("Image copies are missing");
      for (const copy of [w640, w1280]) {
        const up = await db.storage.from("event-media").upload(copy, WEBP, { contentType: "image/webp", upsert: false });
        expect(up.error, `upload ${copy}`).toBeNull();
      }
      const flagged = await db.rpc("set_event_media_variants", { p_media: mediaId });
      expect(flagged.error).toBeNull();
      const row = await adminClient().from("event_media").select("has_variants").eq("id", mediaId).single();
      expect(row.data?.has_variants).toBe(true);
      const all = [name, ...copyNames(name)].sort();
      expect(await storedEventObjects(id)).toEqual(all);

      // Archive: the prepare step lists the original and both copies.
      const archive = await db.rpc("delete_event", { _event: id });
      expect(archive.error).toBeNull();
      const archived = (archive.data as { paths: string[] }).paths;
      expect([...archived].sort()).toEqual([path, w1280, w640].sort());
      await move(archived, false);
      const done = await db.rpc("delete_event", { _event: id, _complete: true });
      expect(done.error).toBeNull();
      expect(await storedEventObjects(id)).toEqual([]);
      expect(await storedEventObjects(`deleted/${id}`)).toEqual(all);

      // Restore: the copies of a flagged image come back too.
      const restore = await db.rpc("restore_event", { _event: id });
      expect(restore.error).toBeNull();
      const restoring = (restore.data as { paths: string[] }).paths;
      expect([...restoring].sort()).toEqual([path, w1280, w640].sort());
      await move(restoring, true);
      const finished = await db.rpc("restore_event", { _event: id, _finalize: true });
      expect(finished.error).toBeNull();
      expect(await storedEventObjects(id)).toEqual(all);
      const back = await adminClient().from("event_media").select("has_variants").eq("id", mediaId).single();
      expect(back.data?.has_variants).toBe(true);
      const event = await adminClient().from("events").select("deleted_at").eq("id", id).single();
      expect(event.data?.deleted_at).toBeNull();
    } finally {
      // A failure half-way may leave archived objects: Storage first, then the rows.
      const left = await storedEventObjects(`deleted/${id}`);
      if (left.length) await adminClient().storage.from("event-media").remove(left.map((n) => `deleted/${id}/${n}`));
      await deleteEvents([id]);
    }
  });
});
