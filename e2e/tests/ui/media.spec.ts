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
  storedMediaObjects,
  uploadRequestAs,
  type TestPhoto,
} from "../../api/media";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { createEventAs, EVENT_TITLE_PREFIX } from "../../api/events";

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
    // A members-only event starting within the hour (upload targets include events up to a day ahead); never public.
    const event = await createEventAs(bm.email, { title: `${EVENT_TITLE_PREFIX}media approve`, branchId: branch, status: "published", startInMinutes: 60 });
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
    // Volunteers never manage: no selection tools.
    await expect(page.getByTestId("media-chapter-tools")).toHaveCount(0);
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
});
