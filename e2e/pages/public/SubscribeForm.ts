import { expect, type Locator, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "../app";

/** "Get event updates" (SubscribeForm), wherever a page places it. */
export class SubscribeForm {
  readonly root: Locator;
  constructor(readonly page: Page, scope?: Locator) {
    this.root = (scope ?? page.locator("body")).getByTestId("subscribe-form");
  }

  readonly email = () => this.root.getByTestId("subscribe-form-email");
  readonly name = () => this.root.getByTestId("subscribe-form-name");
  readonly branch = () => this.root.getByTestId("subscribe-form-branch");
  readonly submit = () => this.root.getByTestId("subscribe-form-submit");
  readonly sent = () => this.page.getByTestId("subscribe-form-sent");

  async subscribe(details: { email: string; name?: string; branchId?: string }) {
    await expect(this.root).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await this.email().fill(details.email);
    if (details.name) await this.name().fill(details.name);
    if (details.branchId) await this.branch().selectOption(details.branchId);
    await this.submit().click();
    await expect(this.sent()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }
}
