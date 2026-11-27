import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A meeting decision's actions ("+ Task", Edit, Delete): in the decision's row on wider screens, in its ⋯ menu
 * (`meeting-decision-menu`) on phones. Same test ids on both.
 */
export async function decisionAction(
  page: Page,
  decision: Locator,
  action: "create-task" | "edit" | "delete",
): Promise<void> {
  await expect(decision.getByTestId("meeting-decision-text-value")).toBeVisible();
  const menu = decision.getByTestId("meeting-decision-menu");
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("menu").getByTestId(`meeting-decision-${action}`).click();
  } else await decision.getByTestId(`meeting-decision-${action}`).click();
}
