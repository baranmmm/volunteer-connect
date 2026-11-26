// Phone toolbars (< 640px) on Tasks and Calendar: one slim sticky header row (title, view switch as icon buttons,
// Filters with the number of non-default settings; Calendar: the other actions in a More actions menu), the settings in a bottom sheet (focus trap, Escape, focus back on
// Filters, Reset to the defaults) and the main action as a floating + button that never covers the last row. Checked
// on Pixel 7 and iPhone SE screens in the mobile project (a phone context: isMobile, touch; the device's viewport is
// set per test), once each; desktop keeps the full toolbar (desktop project).
// Fresh users in a temporary branch; checks look at this test's own ids only.
import { devices, type Locator, type Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { TASK_TITLE_PREFIX, createTaskAs } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { clickCalendarAction } from "../../pages/CalendarPage";

const PHONES = { "Pixel 7": devices["Pixel 7"].viewport, "iPhone SE": devices["iPhone SE"].viewport };
const TASKS = 12;

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} compact-${Date.now().toString(36)}-${++n} ${label}`;
const listRow = (page: Page, id: string) => page.locator(`[data-testid="tasks-list-row"][data-task-id="${id}"]`);
const box = async (l: Locator) => (await l.boundingBox())!;

async function managerWithTasks(
  freshBranch: (label: string) => Promise<string>,
  freshUser: (o: { role: "branch_manager"; branch: string }) => Promise<TestUser>,
) {
  const branch = await freshBranch("compact-toolbar");
  const manager = await freshUser({ role: "branch_manager", branch });
  const ids: string[] = [];
  for (let i = 0; i < TASKS; i++)
    ids.push(await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title(`row ${i}`), assignee_ids: [manager.id] }));
  return { manager, ids };
}

/** Every visible button / select / switch inside `scope` is at least 44 × 44 px (touch targets). */
async function expectTouchTargets(scope: Locator) {
  const controls = scope.locator("button:visible, select:visible, a:visible");
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const b = await box(controls.nth(i));
    // Sub-pixel layout (e.g. 43.9999px for 44px) counts as 44.
    const name = (await controls.nth(i).getAttribute("data-testid")) ?? (await controls.nth(i).getAttribute("role")) ?? `#${i}`;
    expect(Math.round(b.height), `${name} height`).toBeGreaterThanOrEqual(44);
    expect(Math.round(b.width), `${name} width`).toBeGreaterThanOrEqual(44);
  }
}

test.describe("Compact toolbars on phones", () => {
  for (const [name, viewport] of Object.entries(PHONES)) {
    test(`${name}: Tasks has one slim sticky header, the first row in view, the Filters sheet with a count and Reset, and New task as a floating button`, async ({ freshUser, freshBranch, pageAs }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile-pixel7", "phone layout (the mobile project's phone context)");
      test.setTimeout(120_000);
      const { manager, ids } = await managerWithTasks(freshBranch, freshUser);
      const page = await pageAs(manager);
      await page.setViewportSize(viewport);
      await page.goto("/tasks");
      const header = page.getByTestId("tasks-compact-header");
      await expect(header).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expect(page.getByTestId("tasks-list-row").first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

      // One row of at most 15% of the screen; the old toolbar controls are not on the page.
      const head = await box(header);
      expect(head.height).toBeLessThanOrEqual(viewport.height * 0.15);
      await expect(page.getByTestId("tasks-group-by")).toHaveCount(0);
      await expect(page.getByTestId("tasks-filter-mine")).toHaveCount(0);
      await expect(page.getByTestId("tasks-expand-controls")).toHaveCount(0);
      // The first task row is in view without scrolling, directly below the header and above the bottom navigation.
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const first = page.getByTestId("tasks-list-row").first();
      await expect(first).toBeInViewport();
      const nav = await box(page.getByTestId("mobile-bottom-nav"));
      const firstBox = await box(first);
      expect(firstBox.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
      expect(firstBox.y + firstBox.height).toBeLessThanOrEqual(nav.y);

      // The view switch: icon buttons with names and the current one pressed (List on phones).
      for (const v of ["list", "kanban", "calendar"]) await expect(page.getByTestId(`tasks-view-${v}`)).toHaveAttribute("aria-label", /.+/);
      await expect(page.getByTestId("tasks-view-list")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("tasks-view-kanban")).toHaveAttribute("aria-pressed", "false");
      await expectTouchTargets(header);

      // The header stays at the top while the list scrolls.
      const appHeader = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-header-h"));
      await page.evaluate(() => window.scrollTo(0, 400));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect.poll(async () => Math.round((await box(header)).y)).toBe(parseInt(appHeader, 10));
      // The last row is not covered by the floating button (bottom padding below the list).
      const fab = page.getByTestId("tasks-new");
      await expect(fab).toHaveAttribute("data-variant", "fab");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lastRow = page.getByTestId("tasks-list-row").last();
      await expect(lastRow).toBeInViewport();
      const fabBox = await box(fab);
      expect((await box(lastRow)).y + (await box(lastRow)).height).toBeLessThanOrEqual(fabBox.y);
      // Above the bottom navigation, 44px or more.
      expect(fabBox.y + fabBox.height).toBeLessThanOrEqual((await box(page.getByTestId("mobile-bottom-nav"))).y);
      expect(fabBox.width).toBeGreaterThanOrEqual(44);
      await page.evaluate(() => window.scrollTo(0, 0));

      // Filters: no badge at the defaults; the sheet holds the settings, traps focus and counts changes.
      const filters = page.getByTestId("tasks-filters-button");
      const sheet = page.getByTestId("tasks-filters-sheet");
      await expect(filters).toHaveAttribute("data-count", "0");
      await expect(filters).toHaveAttribute("aria-label", "Filters");
      await expect(page.getByTestId("tasks-filters-badge")).toHaveCount(0);
      await filters.click();
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("role", "dialog");
      for (const id of ["tasks-group-by", "tasks-sort", "tasks-filter-mine", "tasks-filter-archived", "tasks-expand-all", "tasks-collapse-all"])
        await expect(sheet.getByTestId(id)).toBeVisible();
      await expectTouchTargets(sheet);
      const focusInSheet = () => sheet.evaluate((el) => el.contains(document.activeElement));
      await expect.poll(focusInSheet).toBe(true);
      for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
      expect(await focusInSheet()).toBe(true);

      await sheet.getByTestId("tasks-group-by").selectOption("due");
      await expect(filters).toHaveAttribute("data-count", "1");
      await sheet.getByTestId("tasks-sort").selectOption("newest");
      await expect(filters).toHaveAttribute("data-count", "2");
      await expect(filters).toHaveAttribute("aria-label", "Filters, 2 active");
      await expect(page.getByTestId("tasks-filters-badge")).toHaveText("2");
      await sheet.getByTestId("tasks-filter-mine").click();
      await expect(filters).toHaveAttribute("data-count", "3");

      // Reset: back to Group by Meeting, Sort Status and My tasks off.
      await page.getByTestId("tasks-filters-reset").click();
      await expect(filters).toHaveAttribute("data-count", "0");
      await expect(sheet.getByTestId("tasks-group-by")).toHaveValue("meeting");
      await expect(sheet.getByTestId("tasks-sort")).toHaveValue("status");
      await expect(sheet.getByTestId("tasks-filter-mine")).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("tasks-filters-badge")).toHaveCount(0);

      // Escape closes it and focus returns to Filters.
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(filters).toBeFocused();
      await expect(listRow(page, ids[0]!)).toBeVisible();

      // Swiping the sheet down closes it too.
      await filters.click();
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(600); // the opening slide
      const top = await box(sheet);
      await page.mouse.move(top.x + top.width / 2, top.y + 12);
      await page.mouse.down();
      await page.mouse.move(top.x + top.width / 2, top.y + 12 + top.height * 0.8, { steps: 12 });
      await page.mouse.up();
      await expect(sheet).toHaveCount(0);
      await expect(filters).toBeFocused();

      // The floating button opens the new task form.
      await fab.click();
      await expect(page.getByTestId("task-form")).toBeVisible();
    });
  }

  for (const [name, viewport] of Object.entries(PHONES)) {
    test(`${name}: Calendar has the same compact header (nothing overflows), Filters sheet, More actions menu and floating Create event button`, async ({ freshUser, freshBranch, pageAs }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile-pixel7", "phone layout (the mobile project's phone context)");
      test.setTimeout(90_000);
      const branch = await freshBranch("compact-calendar");
      const manager = await freshUser({ role: "branch_manager", branch });
      const page = await pageAs(manager);
      await page.setViewportSize(viewport);
      await page.goto("/calendar");
      const header = page.getByTestId("calendar-compact-header");
      await expect(header).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expect(page.getByTestId("calendar-more-actions")).toBeVisible();
      expect((await box(header)).height).toBeLessThanOrEqual(viewport.height * 0.15);
      await expect(page.getByTestId("calendar-view-list")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("calendar-filter-category")).toHaveCount(0);
      await expectTouchTargets(header);
      // Nothing in the header goes past the screen edge, and the page never scrolls sideways.
      for (const el of await header.locator("button, h1").all()) {
        const b = await box(el);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(Math.round(b.x + b.width)).toBeLessThanOrEqual(viewport.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // The old row of action buttons is gone: they are in the More actions menu.
      await expect(page.getByTestId("calendar-compact-actions")).toHaveCount(0);
      await expect(page.getByTestId("calendar-add-past-event-button")).toHaveCount(0);

      const filters = page.getByTestId("calendar-filters-button");
      await filters.click();
      const sheet = page.getByTestId("calendar-filters-sheet");
      await expect(sheet.getByTestId("calendar-filter-category")).toBeVisible();
      await sheet.getByTestId("calendar-filter-past").click();
      await expect(filters).toHaveAttribute("data-count", "1");
      await page.getByTestId("calendar-filters-reset").click();
      await expect(filters).toHaveAttribute("data-count", "0");
      await expect(sheet.getByTestId("calendar-filter-upcoming")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(filters).toBeFocused();

      // More actions (⋯): a real menu button; the manager's three actions, each 44px or more; Escape closes it and
      // focus returns to the button.
      const more = page.getByTestId("calendar-more-actions");
      const menu = page.getByTestId("calendar-more-actions-menu");
      await expect(more).toHaveAttribute("aria-label", "More actions");
      await expect(more).toHaveAttribute("aria-haspopup", "menu");
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await more.click();
      await expect(menu).toBeVisible();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(menu.getByRole("menuitem")).toHaveCount(3);
      for (const id of ["event-request-open-button", "calendar-add-past-event-button", "calendar-my-requests-link"]) {
        // Measured once the opening zoom has finished.
        await expect.poll(async () => Math.round((await box(menu.getByTestId(id))).height), id).toBeGreaterThanOrEqual(44);
        const b = await box(menu.getByTestId(id));
        expect(Math.round(b.x + b.width), id).toBeLessThanOrEqual(viewport.width);
      }
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();
      // Keyboard: Enter opens it, the arrow keys move between the items.
      await page.keyboard.press("Enter");
      await expect(menu).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();

      // Each item works as before: Request an event opens the request form, Add past event its dialog, My requests
      // goes to the Requests page.
      await clickCalendarAction(page, "event-request-open-button");
      await expect(page.getByTestId("event-request-type-choice")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("event-request-type-choice")).toHaveCount(0);
      await expect(more).toBeFocused();
      await clickCalendarAction(page, "calendar-add-past-event-button");
      await expect(page.getByTestId("past-event-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("past-event-dialog")).toHaveCount(0);
      await expect(more).toBeFocused();

      await clickCalendarAction(page, "calendar-my-requests-link");
      await expect(page).toHaveURL(/\/requests\?tab=mine/);

      await page.goBack();
      const create = page.getByTestId("calendar-create-event-button");
      await expect(create).toHaveAttribute("data-variant", "fab", { timeout: APP_LOAD_TIMEOUT });
      await create.click();
      await expect(page.getByTestId("event-form")).toBeVisible();
    });
  }

  test("Calendar: a volunteer's More actions menu has only their own actions (no Add past event)", async ({ freshUser, freshBranch, pageAs }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-pixel7", "phone layout");
    const branch = await freshBranch("compact-calendar-vol");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await page.goto("/calendar");
    await page.getByTestId("calendar-more-actions").click({ timeout: APP_LOAD_TIMEOUT });
    const menu = page.getByTestId("calendar-more-actions-menu");
    await expect(menu.getByTestId("event-request-open-button")).toBeVisible();
    await expect(menu.getByTestId("calendar-my-requests-link")).toBeVisible();
    await expect(menu.getByTestId("calendar-add-past-event-button")).toHaveCount(0);
    await expect(page.getByTestId("calendar-create-event-button")).toHaveCount(0);
  });

  test("desktop keeps the full Tasks toolbar", async ({ freshUser, freshBranch, pageAs }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
    const branch = await freshBranch("compact-desktop");
    const manager = await freshUser({ role: "branch_manager", branch });
    const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("desktop") });
    const page = await pageAs(manager);
    await page.goto("/tasks");
    await expect(page.getByTestId("tasks-group-by")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.locator(`[data-task-id="${id}"]`).first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    for (const testId of ["tasks-sort", "tasks-filter-mine", "tasks-filter-archived", "tasks-view-kanban", "tasks-new"])
      await expect(page.getByTestId(testId)).toBeVisible();
    await expect(page.getByTestId("tasks-new")).not.toHaveAttribute("data-variant", "fab");
    await expect(page.getByTestId("tasks-view-list")).toHaveText(/\S/);
    await expect(page.getByTestId("tasks-compact-header")).toHaveCount(0);
    await expect(page.getByTestId("tasks-filters-button")).toHaveCount(0);
  });
});
