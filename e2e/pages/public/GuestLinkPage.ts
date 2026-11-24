import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "../app";

/** /e/confirm?t= and /e/cancel?t= (links in guest emails): the event, then a button; never an action on load. */
export class GuestLinkPage {
  constructor(readonly page: Page) {}

  readonly root = () => this.page.getByTestId("guest-link-page");
  readonly event = () => this.page.getByTestId("guest-link-event");
  readonly state = () => this.page.getByTestId("guest-link-state");
  readonly confirmButton = () => this.page.getByTestId("guest-confirm-button");
  readonly cancelButton = () => this.page.getByTestId("guest-cancel-button");

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
