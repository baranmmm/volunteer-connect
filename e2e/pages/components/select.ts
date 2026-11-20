import type { Page } from "@playwright/test";

/**
 * Picks an option in a Radix Select by test id `<optionPrefix>-<value>`.
 * Until Lovable adds option test ids (see e2e/README.md), it falls back to the option's position,
 * which is deterministic for every select we use. Never matches on text.
 */
export async function pickOption(page: Page, triggerTestId: string, optionPrefix: string, value: string, fallbackIndex: number) {
  await page.getByTestId(triggerTestId).click();
  const byId = page.getByTestId(`${optionPrefix}-${value}`);
  if (await byId.count()) {
    await byId.click();
    return;
  }
  const options = page.getByRole("option");
  await options.first().waitFor();
  await options.nth(fallbackIndex).click();
}
