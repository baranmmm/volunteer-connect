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
