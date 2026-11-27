// The Media tab (members-only branch gallery): a Branch Manager uploads into a new album; a volunteer's upload request
// is approved in part (the photo shows, the deselected file is deleted) or declined (every file deleted); multi-select
// "Move to…"; the slideshow; the mobile stories row and story viewer. Every branch, person, event and album is created
// for the test (a temporary branch: no other test sees it); photos are placeholder gradients.
import type { Page } from "@playwright/test";
import { test, expect, type TestUser } from "../../fixtures/roles";
import {
  addLibraryPhotoAs,
  createAlbumAs,
  gradientPhoto,
  PALETTE,
  starAs,
  storedMediaObjects,
  uploadRequestAs,
  type TestPhoto,
} from "../../api/media";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { createEventAs, EVENT_TITLE_PREFIX } from "../../api/events";
import { adminClient } from "../../api/SupabaseClient";

let n = 0;
const photo = (i = n++) => gradientPhoto(PALETTE[i % PALETTE.length]!, i, 900, 600);
const file = (p: TestPhoto, name: string) => ({ name, mimeType: "image/webp", buffer: p.original });

async function people(freshBranch: (l: string) => Promise<string>, freshUser: (o: { branch: string; role?: "branch_manager" | "volunteer" | "trustee" }) => Promise<TestUser>, label: string) {
  const branch = await freshBranch(`media-${label}`);
  const bm = await freshUser({ branch, role: "branch_manager" });
  const vol = await freshUser({ branch, role: "volunteer" });
  return { branch, bm, vol };
}

/** "Add photos" / "Request upload": the header button on desktop, the ⋯ menu on phones. */
async function openAdd(page: Page) {
  const button = page.getByTestId("media-add");
  if (await button.isVisible().catch(() => false)) await button.click();
  else {
    await page.getByTestId("media-more").click();
    await page.getByTestId("media-more-add").click();
  }
  await expect(page.getByTestId("media-upload-dialog")).toBeVisible();
}

async function openMedia(page: Page, search = "") {
  await page.goto(`/media${search}`);
  await expect(page.getByTestId(search ? "media-chapter-view" : /media-(desktop|mobile)/)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
}

test.describe("Media", () => {
  test("a Branch Manager adds photos to a new album; they show in its chapter view", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm } = await people(freshBranch, freshUser, "upload");
    const page = await pageAs(bm);
    await openMedia(page);
    await openAdd(page);
    await page.getByTestId("media-upload-target").selectOption("new");
    await page.getByTestId("media-upload-new-title").fill("Volunteer meet-ups");
    const [a, b] = [await photo(), await photo()];
    await page.getByTestId("media-upload-files").setInputFiles([file(a, "a.webp"), file(b, "b.webp")]);
    await page.getByTestId("media-upload-submit").click();
    await expect(page.getByTestId("media-chapter-view")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("media-chapter-title")).toHaveText("Volunteer meet-ups");
    await expect(page.getByTestId("media-masonry-photo")).toHaveCount(2);
    // Each photo: a WebP original and its two copies in the branch's folder.
    const ids = await page.getByTestId("media-masonry-photo").evaluateAll((els) => els.map((e) => e.getAttribute("data-photo-id")!));
    expect(await storedMediaObjects(branch, ids)).toHaveLength(6);
  });

  test("a volunteer's upload request is approved in part: the photo shows, the deselected file is deleted", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "approve");
    // A members-only event that started half an hour ago (only started events take photos); never public.
    const event = await createEventAs(bm.email, { title: `${EVENT_TITLE_PREFIX}media approve`, branchId: branch, status: "published", startInMinutes: -30, durationMinutes: 180 });
    const volunteer = await pageAs(vol);
    await openMedia(volunteer);
    await openAdd(volunteer);
    await volunteer.getByTestId("media-upload-target").selectOption(`event:${event}`);
    await volunteer.getByTestId("media-upload-files").setInputFiles([file(await photo(), "keep.webp"), file(await photo(), "drop.webp")]);
    await volunteer.getByTestId("media-upload-note").fill("From the evening");
    await volunteer.getByTestId("media-upload-submit").click();
    await expect(volunteer.getByTestId("toast-success").last()).toBeVisible();

    const manager = await pageAs(bm);
    await manager.goto("/requests?tab=review");
    const card = manager.getByTestId("media-review-request");
    await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const requestFiles = card.getByTestId("media-request-file");
    await expect(requestFiles).toHaveCount(2);
    const fileIds = await requestFiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-file-id")!));
    await requestFiles.nth(1).click(); // deselect the second photo
    await expect(requestFiles.nth(1)).toHaveAttribute("aria-pressed", "false");
    await card.getByTestId("media-review-approve").click();
    await expect(manager.getByTestId("toast-success").last()).toBeVisible();
    await expect.poll(() => storedMediaObjects(branch, [fileIds[1]!])).toEqual([]);
    expect(await storedMediaObjects(branch, [fileIds[0]!])).toHaveLength(3);

    await openMedia(volunteer, `?event=${event}`);
    await expect(volunteer.getByTestId("media-masonry-photo")).toHaveCount(1);
    await expect(volunteer.locator(`[data-testid="media-masonry-photo"][data-photo-id="${fileIds[0]}"]`)).toBeVisible();
  });

  test("a declined request: every file is deleted and the volunteer sees the reason", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "decline");
    const album = await createAlbumAs(bm.email, branch, "Ramadan 2026");
    const request = await uploadRequestAs(vol.email, { album_id: album }, [await photo(), await photo()]);
    expect(await storedMediaObjects(branch, request.files)).toHaveLength(6);
    const manager = await pageAs(bm);
    await manager.goto("/requests?tab=review");
    const card = manager.locator(`[data-testid="media-review-request"][data-request-id="${request.id}"]`);
    await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await card.getByTestId("media-review-decline").click();
    await card.getByTestId("media-review-reason").fill("Blurry");
    await card.getByTestId("media-review-decline-confirm").click();
    await expect(manager.getByTestId("toast-success").last()).toBeVisible();
    await expect.poll(() => storedMediaObjects(branch, request.files)).toEqual([]);

    const volunteer = await pageAs(vol);
    await volunteer.goto("/requests?tab=mine");
    const mine = volunteer.locator(`[data-testid="media-request"][data-request-id="${request.id}"]`);
    await expect(mine).toHaveAttribute("data-status", "declined", { timeout: APP_LOAD_TIMEOUT });
    await expect(mine.getByTestId("media-request-reason")).toContainText("Blurry");
  });

  test("a Branch Manager selects photos and moves them to another album", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm } = await people(freshBranch, freshUser, "move");
    const from = await createAlbumAs(bm.email, branch, "Iftar 2026");
    const to = await createAlbumAs(bm.email, branch, "Ramadan 2026");
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await addLibraryPhotoAs(bm.email, branch, { album_id: from }, await photo()));
    const page = await pageAs(bm);
    await openMedia(page, `?album=${from}`);
    await page.getByTestId("media-select").click();
    for (const id of ids.slice(0, 2)) await page.locator(`[data-testid="media-masonry-photo"][data-photo-id="${id}"]`).click();
    await expect(page.getByTestId("media-selected-count")).toContainText("2");
    await page.getByTestId("media-move-selected").click();
    await page.getByTestId("media-move-target").selectOption(`album:${to}`);
    await page.getByTestId("media-move-submit").click();
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    await expect(page.locator(`[data-testid="media-chapter-view"][data-chapter-id="${to}"]`)).toBeVisible();
    await expect(page.getByTestId("media-masonry-photo")).toHaveCount(2);
    await openMedia(page, `?album=${from}`);
    await expect(page.getByTestId("media-masonry-photo")).toHaveCount(1);
    // Same files, only the album changed.
    expect(await storedMediaObjects(branch, ids)).toHaveLength(9);
  });

  test("a volunteer plays an album as a slideshow: counter, next, pause, interval, Escape", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "slideshow");
    const album = await createAlbumAs(bm.email, branch, "Peace Walk");
    for (let i = 0; i < 3; i++) await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo());
    const page = await pageAs(vol);
    await openMedia(page, `?album=${album}`);
    // Volunteers never manage: no move, delete, arrange or album tools (they may select photos to request downloads).
    for (const id of ["media-move-selected", "media-delete-selected", "media-arrange", "media-album-edit", "media-album-delete"])
      await expect(page.getByTestId(id)).toHaveCount(0);
    await page.getByTestId("media-chapter-play").click();
    const show = page.getByTestId("media-slideshow-view");
    await expect(show).toBeVisible();
    await expect(show.getByTestId("media-slideshow-counter")).toHaveText("1 / 3");
    await expect(show.getByTestId("media-slideshow-title")).toHaveText("Peace Walk");
    await show.getByTestId("media-slideshow-next").click();
    await expect(show.getByTestId("media-slideshow-counter")).toHaveText("2 / 3");
    await show.getByTestId("media-slideshow-play").click();
    await expect(show.getByTestId("media-slideshow-play")).toHaveAttribute("aria-pressed", "true");
    await show.getByTestId("media-slideshow-settings").click();
    await show.getByTestId("media-slideshow-interval-5").click();
    await expect(show.getByTestId("media-slideshow-interval-5")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
  });

  test("phones: the stories row (amber until viewed) opens the story viewer", async ({ freshBranch, freshUser, pageAs }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-pixel7", "The stories row is the phone layout");
    const { branch, bm, vol } = await people(freshBranch, freshUser, "stories");
    const album = await createAlbumAs(bm.email, branch, "Volunteer meet-ups");
    for (let i = 0; i < 2; i++) await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo());
    const page = await pageAs(vol);
    await openMedia(page);
    const story = page.locator(`[data-testid="media-story"][data-chapter-id="${album}"]`);
    await expect(story).toHaveAttribute("data-unseen", "true");
    await expect(page.getByTestId("media-grid-photo")).toHaveCount(2);
    await story.click();
    const viewer = page.getByTestId("media-story-viewer");
    await expect(viewer.getByTestId("media-story-title")).toHaveText("Volunteer meet-ups");
    await expect(viewer).toContainText("1 of 2");
    await viewer.getByTestId("media-story-next").click();
    await expect(viewer).toContainText("2 of 2");
    await viewer.getByTestId("media-story-close").click();
    await expect(story).toHaveAttribute("data-unseen", "false", { timeout: APP_LOAD_TIMEOUT });
  });

  test("phones: Back closes the story viewer (after moving on) and the lightbox, keeping the place", async ({ freshBranch, freshUser, pageAs }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-pixel7", "The phone's Back button and the stories row");
    const { branch, bm, vol } = await people(freshBranch, freshUser, "back");
    const album = await createAlbumAs(bm.email, branch, "Volunteer meet-ups");
    for (let i = 0; i < 15; i++) await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo());
    const page = await pageAs(vol);
    await page.goto("/dashboard");
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await openMedia(page);
    const stories = page.getByTestId("media-stories");

    // Story: next photo (replaces the entry), then Back closes it and stays on /media.
    await page.locator(`[data-testid="media-story"][data-chapter-id="${album}"]`).click();
    const viewer = page.getByTestId("media-story-viewer");
    await expect(viewer).toContainText("1 of 15");
    await expect(page).toHaveURL(/story=album/);
    await viewer.getByTestId("media-story-next").click();
    await expect(viewer).toContainText("2 of 15");
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(/\/media$/);
    await expect(stories).toBeVisible();

    // Closing with the X goes back too: a second Back leaves Media and never reopens the story.
    await page.locator(`[data-testid="media-story"][data-chapter-id="${album}"]`).click();
    await expect(viewer).toBeVisible();
    await viewer.getByTestId("media-story-close").click();
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(/\/media$/);

    // Lightbox from the grid, scrolled down: Back closes it and the scroll position stays.
    const grid = page.getByTestId("media-grid-photo");
    await expect(grid).toHaveCount(15);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrolled = await page.evaluate(() => window.scrollY);
    await grid.nth(14).click();
    const lightbox = page.getByTestId("media-lightbox");
    await expect(lightbox).toBeVisible();
    await expect(page).toHaveURL(/photo=/);
    await page.goBack();
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(/\/media$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 5);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(scrolled + 5);

    // A reloaded lightbox link opens the same photo.
    const photoId = await grid.nth(3).getAttribute("data-photo-id");
    await grid.nth(3).click();
    await page.reload();
    await expect(page.getByTestId("media-lightbox")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    expect(new URL(page.url()).searchParams.get("photo")).toBe(photoId);
    await page.getByTestId("media-lightbox-close").click();
    await expect(page.getByTestId("media-lightbox")).toHaveCount(0);
    await expect(page).toHaveURL(/\/media$/);

    // The rest of the way back leaves Media (no overlay reopens on the way).
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("media-story-viewer")).toHaveCount(0);
  });

  test("phones: the bottom bar is Dashboard · Calendar · Tasks · Media; Meetings opens from More", async ({ freshBranch, freshUser, pageAs }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-pixel7", "The phone bottom bar");
    const { vol } = await people(freshBranch, freshUser, "nav");
    const page = await pageAs(vol);
    await page.goto("/dashboard");
    const bar = page.getByTestId("mobile-bottom-nav");
    await expect(bar).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const keys = await bar.locator('a[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(keys).toEqual(["nav-dashboard", "nav-calendar", "nav-tasks", "nav-media"]);
    await expect(bar.getByTestId("mobile-nav-more")).toBeVisible();
    await bar.getByTestId("nav-media").click();
    await expect(page).toHaveURL(/\/media/);
    await expect(bar.getByTestId("nav-media")).toHaveAttribute("data-status", "active");
    await page.getByTestId("mobile-nav-more").click();
    const sheet = page.getByTestId("mobile-nav-more-sheet");
    const first = sheet.locator('a[data-testid^="nav-"]').first();
    await expect(first).toHaveAttribute("data-testid", "nav-meetings");
    await first.click();
    await expect(page).toHaveURL(/\/meetings/);
  });

  test("download request: a volunteer asks, the Branch Manager approves, the 24-hour link works, then expires", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "download");
    const album = await createAlbumAs(bm.email, branch, "Peace Walk");
    const photoId = await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo());
    const volunteer = await pageAs(vol);
    await openMedia(volunteer, `?album=${album}`);
    await volunteer.locator(`[data-testid="media-masonry-photo"][data-photo-id="${photoId}"]`).click();
    // Volunteers see "Request download" only: never a direct download, star or delete.
    const lightbox = volunteer.getByTestId("media-lightbox");
    await expect(lightbox.getByTestId("media-lightbox-download")).toHaveCount(0);
    await expect(lightbox.getByTestId("media-lightbox-star")).toHaveCount(0);
    await lightbox.getByTestId("media-lightbox-request-download").click();
    await volunteer.getByTestId("media-download-reason").fill("For the newsletter");
    await volunteer.getByTestId("media-download-submit").click();
    await expect(volunteer.getByTestId("toast-success").last()).toBeVisible();
    const { data: rows } = await adminClient().from("media_download_requests").select("id").eq("branch_id", branch);
    const requestId = rows![0]!.id as string;

    const manager = await pageAs(bm);
    await manager.goto("/requests?tab=review");
    const card = manager.locator(`[data-testid="media-download-review"][data-request-id="${requestId}"]`);
    await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await card.getByTestId("media-download-approve").click();
    await expect(manager.getByTestId("toast-success").last()).toBeVisible();

    // The notice's link: previews, then the full-size file links on request.
    await volunteer.goto(`/media/download/${requestId}`);
    await expect(volunteer.getByTestId("media-download-valid")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await volunteer.getByTestId("media-download-prepare").click();
    const link = volunteer.getByTestId("media-download-file");
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute("href");
    expect(href).toContain(`${branch}/${photoId}.webp`);
    expect((await volunteer.request.get(href!)).status()).toBe(200);
    // Someone else opening the link gets nothing.
    const other = await pageAs(bm);
    await other.goto(`/media/download/${requestId}`);
    await expect(other.getByTestId("media-download-valid")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await other.getByTestId("media-download-prepare").click();
    await expect(other.getByTestId("media-download-file")).toHaveCount(0);

    // After 24 hours the page says the link has expired.
    await adminClient().from("media_download_requests").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", requestId);
    await volunteer.reload();
    await expect(volunteer.getByTestId("media-download-expired")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("highlights: a starred photo shows in the highlights and plays as a slideshow", async ({ freshBranch, freshUser, pageAs }, testInfo) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "highlights");
    const album = await createAlbumAs(bm.email, branch, "Meet-ups");
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push(await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo()));
    // The Branch Manager stars one in the lightbox.
    const manager = await pageAs(bm);
    await openMedia(manager, `?album=${album}`);
    await manager.locator(`[data-testid="media-masonry-photo"][data-photo-id="${ids[1]}"]`).click();
    const star = manager.getByTestId("media-lightbox-star");
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    // The volunteer sees it in the strip (desktop) or the card (phones), and in the highlights slideshow.
    const volunteer = await pageAs(vol);
    await openMedia(volunteer);
    const mobile = testInfo.project.name === "mobile-pixel7";
    const item = volunteer.getByTestId(mobile ? "media-highlight-card-item" : "media-highlight");
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute("data-photo-id", ids[1]!);
    await volunteer.getByTestId("media-slideshow").click();
    await expect(volunteer.getByTestId("media-slideshow-view")).toBeVisible();
    await expect(volunteer.getByTestId("media-slideshow-counter")).toHaveText("1 / 1");
  });

  test("dashboard: the latest photos strip opens a photo in the Media lightbox", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "latest");
    const volunteer = await pageAs(vol);
    await volunteer.goto("/dashboard");
    await expect(volunteer.getByTestId("dashboard-welcome")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(volunteer.getByTestId("dashboard-latest-photos")).toHaveCount(0); // hidden without photos
    const album = await createAlbumAs(bm.email, branch, "Ramadan 2026");
    const id = await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo());
    await volunteer.reload();
    const tile = volunteer.locator(`[data-testid="dashboard-latest-photo"][data-photo-id="${id}"]`);
    await expect(tile).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await tile.click();
    await expect(volunteer).toHaveURL(/\/media\?.*photo=/);
    await expect(volunteer.getByTestId("media-lightbox")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("the post-event nudge's link opens the upload request form with the event chosen", async ({ freshBranch, freshUser, pageAs }) => {
    const { branch, bm, vol } = await people(freshBranch, freshUser, "nudge");
    const event = await createEventAs(bm.email, { title: `${EVENT_TITLE_PREFIX}media nudge`, branchId: branch, status: "published", startInMinutes: -30, durationMinutes: 180 });
    const volunteer = await pageAs(vol);
    await volunteer.goto(`/media?request=event:${event}`);
    await expect(volunteer.getByTestId("media-upload-dialog")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(volunteer.getByTestId("media-upload-target")).toHaveValue(`event:${event}`);
    await expect(volunteer).not.toHaveURL(/request=/);
  });

  test("phones: a follower opens Media of the branch they follow, read-only (public events and albums)", async ({ freshBranch, freshUser, pageAs }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-pixel7", "The follower's phone layout");
    const branch = await freshBranch("media-follower");
    const bm = await freshUser({ branch, role: "branch_manager" });
    const follower = await freshUser({ branch, role: "follower" });
    const album = await createAlbumAs(bm.email, branch, "Volunteer meet-ups");
    await addLibraryPhotoAs(bm.email, branch, { album_id: album }, await photo());
    // A public event that has started (its cover counts: added after the start) and a members-only one.
    const open = await createEventAs(bm.email, { title: `${EVENT_TITLE_PREFIX}follower open`, branchId: branch, status: "published", audience: "public", startInMinutes: -30, durationMinutes: 180 });
    const members = await createEventAs(bm.email, { title: `${EVENT_TITLE_PREFIX}follower members`, branchId: branch, status: "published", startInMinutes: -30, durationMinutes: 180 });
    await addLibraryPhotoAs(bm.email, branch, { event_id: members }, await photo());

    const page = await pageAs(follower);
    await page.goto("/dashboard");
    const bar = page.getByTestId("mobile-bottom-nav");
    await expect(bar).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const keys = await bar.locator('a[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(keys).toEqual(["nav-dashboard", "nav-calendar", "nav-requests", "nav-media"]);
    await bar.getByTestId("nav-media").click();
    await expect(page.getByTestId("media-mobile")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    // The album and the public event; never the members-only event.
    await expect(page.locator(`[data-testid="media-story"][data-chapter-id="${album}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="media-story"][data-chapter-id="${open}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="media-story"][data-chapter-id="${members}"]`)).toHaveCount(0);
    // Read-only: no "+" circle, no add in the ⋯ menu, no actions in the lightbox.
    await expect(page.getByTestId("media-story-add")).toHaveCount(0);
    await page.getByTestId("media-more").click();
    await expect(page.getByTestId("media-more-add")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("media-grid-photo").first().click();
    const lightbox = page.getByTestId("media-lightbox");
    await expect(lightbox).toBeVisible();
    for (const id of ["media-lightbox-request-download", "media-lightbox-star", "media-lightbox-download", "media-lightbox-delete"])
      await expect(lightbox.getByTestId(id)).toHaveCount(0);
  });
});
