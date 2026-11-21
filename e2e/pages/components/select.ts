import type { Page } from "@playwright/test";

/** Opens a Radix Select by its trigger test id and clicks the option with test id `<optionPrefix>-<value>`. */
export async function pickOption(page: Page, triggerTestId: string, optionPrefix: string, value: string) {
  await page.getByTestId(triggerTestId).click();
  await page.getByTestId(`${optionPrefix}-${value}`).click();
}
