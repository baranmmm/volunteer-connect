import { expect, type Locator, type Page } from "@playwright/test";

/** Switches /tasks to the Board (List is the default; the choice is remembered per user on larger screens). */
export async function showBoard(page: Page) {
  const board = page.getByTestId("tasks-view-kanban");
  await expect(board).toBeVisible({ timeout: 60_000 });
  if ((await board.getAttribute("aria-pressed")) !== "true") await board.click();
  await expect(board).toHaveAttribute("aria-pressed", "true");
}

/** Sets a task's status through its menu: the "…" on a board card or the status pill of a list row. */
export async function setStatusByMenu(page: Page, trigger: Locator, status: string) {
  await trigger.click();
  await page.locator(`[data-testid="task-status-option"][data-status="${status}"]`).click();
}

/** Phones (< 640px): the page settings live in the Filters bottom sheet instead of the toolbar. */
export const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < 640;

/**
 * Opens the Filters sheet (`${prefix}-filters-sheet`) on phones so its controls (Group by, Sort, My tasks, Archived,
 * Expand/Collapse all, branch filters…) can be used; does nothing on wider screens, where they are in the toolbar.
 */
export async function openFilters(page: Page, prefix: "tasks" | "calendar" = "tasks") {
  if (!isNarrow(page)) return;
  const sheet = page.getByTestId(`${prefix}-filters-sheet`);
  if (await sheet.isVisible()) return;
  await page.getByTestId(`${prefix}-filters-button`).click();
  await expect(sheet).toBeVisible();
}

/** Closes the Filters sheet on phones (Escape); does nothing on wider screens or when it is already closed. */
export async function closeFilters(page: Page, prefix: "tasks" | "calendar" = "tasks") {
  if (!isNarrow(page)) return;
  const sheet = page.getByTestId(`${prefix}-filters-sheet`);
  if (await sheet.isVisible()) await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
}

/** Runs `fn` with the Tasks settings reachable: inside the open Filters sheet on phones, closed again afterwards. */
export async function withTaskFilters<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  await openFilters(page);
  const result = await fn();
  await closeFilters(page);
  return result;
}
