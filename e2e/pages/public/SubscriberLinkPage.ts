import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "../app";

/** /updates/confirm?t= and /updates/unsubscribe?t= (links in subscriber emails); both need a click. */
export class SubscriberLinkPage {
  constructor(readonly page: Page) {}

  readonly root = () => this.page.getByTestId("subscriber-link-page");
  readonly state = () => this.page.getByTestId("subscriber-link-state");
  readonly confirmButton = () => this.page.getByTestId("subscriber-confirm-button");
  readonly unsubscribeButton = () => this.page.getByTestId("subscriber-unsubscribe-button");

  /** A full link from an email (opened on this run's app origin) or an app path. */
  async open(link: string) {
    const url = new URL(link, "http://app.invalid");
    await this.page.goto(`${url.pathname}${url.search}`);
    await expect(this.root()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  async expectState(state: string) {
    await expect(this.state()).toHaveAttribute("data-state", state, { timeout: APP_LOAD_TIMEOUT });
  }
}
