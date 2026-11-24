// Past events: a manager records an event that already took place, with photos (per-photo public gallery tick) and a
// YouTube link. The landing data shows only the ticked photo.
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX, TINY_PNG, deleteEvents } from "../../api/events";
import { copyNames, storedEventObjects } from "../../api/images";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { EventPage } from "../../pages/EventPage";
import { PastEventDialog } from "../../pages/components/PastEventDialog";

const daysAgo = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() - days * 86400000));

test.describe("Past events", () => {
  test("a branch manager adds a past event with two photos (one in the gallery) and a video; only the ticked photo reaches the landing gallery", async ({ freshUser, pageAs }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-add-past-event-button").click({ timeout: APP_LOAD_TIMEOUT });
    const dialog = new PastEventDialog(page);
    const title = `${EVENT_TITLE_PREFIX}${runId} past ${Date.now()}`;
    await dialog.title().fill(title);
    // A future date is refused in the form.
    await dialog.date().fill(daysAgo(-3));
    await dialog.saveButton().click();
    await expect(dialog.root.locator("#past-event-date-error")).toBeVisible();
    await dialog.date().fill(daysAgo(10));
    await dialog.description().fill("A dialogue evening that took place.");
    await dialog.addPhoto("first.png", TINY_PNG);
    await dialog.addPhoto("second.png", TINY_PNG);
    // Photos are in the gallery by default; keep the first only.
    await expect(dialog.galleryTick(0)).toBeChecked();
    await dialog.galleryTick(1).click();
    await expect(dialog.galleryTick(1)).not.toBeChecked();
    // An invalid link is refused; a youtu.be link is accepted.
    await dialog.videoUrl().fill("https://example.org/not-youtube");
    await dialog.addVideoButton().click();
    await expect(dialog.root.locator("#past-event-video-error")).toBeVisible();
    await dialog.addVideo("https://youtu.be/dQw4w9WgXcQ");
    await dialog.save();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    try {
      const event = new EventPage(page);
      await expect(event.title()).toHaveText(title, { timeout: APP_LOAD_TIMEOUT });
      await expect(event.pastRecordBadge()).toBeVisible();
      await expect(page.getByTestId("event-detail-image")).toHaveCount(2);
      await expect(event.videos()).toHaveCount(1);
      await expect(event.videos().first()).toHaveAttribute("data-youtube-id", "dQw4w9WgXcQ");
      // No registration on a past record.
      await expect(event.registration()).toHaveCount(0);

      const row = await adminClient().from("events").select("past_record, audience, status, start_date, branch_id").eq("id", id).single();
      expect(row.data).toEqual({ past_record: true, audience: "public", status: "published", start_date: daysAgo(10), branch_id: manager.branchId });
      const media = await adminClient().from("event_media").select("id, in_gallery, width, height").eq("event_id", id).order("position");
      expect(media.data!.map((m) => m.in_gallery)).toEqual([true, false]);
      expect(media.data!.every((m) => m.width === 1 && m.height === 1)).toBe(true);

      // Landing data (service role, as the landing server reads it): the gallery holds only the ticked photo.
      const landing = await adminClient().rpc("public_landing_data");
      expect(landing.error).toBeNull();
      const gallery = (landing.data as { gallery: { event_id: string; photos: { id: string }[] }[] }).gallery;
      const entry = gallery.find((g) => g.event_id === id);
      expect(entry?.photos.map((p) => p.id)).toEqual([media.data![0]!.id]);

      // Each photo has its two resized copies next to it, and the rows are flagged.
      const rows = await adminClient().from("event_media").select("id, storage_path, has_variants").eq("event_id", id).order("position");
      expect(rows.data!.map((m) => m.has_variants)).toEqual([true, true]);
      const names = rows.data!.map((m) => m.storage_path.split("/").pop()!);
      expect(await storedEventObjects(id)).toEqual(names.flatMap((n) => [n, ...copyNames(n)]).sort());
      // Removing a photo removes the original and both copies from Storage, then the row.
      await event.editButton().click();
      await expect(dialog.photos()).toHaveCount(2, { timeout: APP_LOAD_TIMEOUT });
      await dialog.photos().nth(1).getByTestId("past-event-photo-remove").click();
      await expect(dialog.photos()).toHaveCount(1);
      await dialog.save();
      await expect(page.getByTestId("event-detail-image")).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
      expect(await storedEventObjects(id)).toEqual([names[0]!, ...copyNames(names[0]!)].sort());
      const left = await adminClient().from("event_media").select("id").eq("event_id", id);
      expect(left.data!.map((m) => m.id)).toEqual([rows.data![0]!.id]);
    } finally {
      await deleteEvents([id]);
    }
  });
});
