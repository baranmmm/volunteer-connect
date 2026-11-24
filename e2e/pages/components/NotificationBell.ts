import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "../app";

/**
 * The header bell (`header-notifications-bell`): one per header, desktop top bar or mobile header, each visible at
 * one breakpoint only. It opens `notifications-popover` (a popover on desktop, a full-height sheet on phones).
 */
export class NotificationBell {
  constructor(private readonly page: Page) {}

  readonly bell = () => this.page.getByTestId("header-notifications-bell").filter({ visible: true });
  readonly badge = () => this.bell().getByTestId("header-notifications-badge");
  readonly panel = () => this.page.getByTestId("notifications-popover");
  readonly markAll = () => this.panel().getByTestId("notifications-mark-all");
  readonly seeAll = () => this.panel().getByTestId("notifications-see-all");
  /** A notice row by kind (`dashboard-notification`, carries data-notification-id / data-unread). */
  readonly notice = (kind: string) => this.panel().locator(`[data-testid="dashboard-notification"][data-kind="${kind}"]`);
  readonly group = (kind: string) => this.panel().locator(`[data-testid="dashboard-notification-group"][data-kind="${kind}"]`);

  async open() {
    await expect(this.bell()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await this.bell().click();
    await expect(this.panel()).toBeVisible();
  }

  /** Escape closes the panel and gives focus back to the bell. */
  async close() {
    await this.page.keyboard.press("Escape");
    await expect(this.panel()).toBeHidden();
    await expect(this.bell()).toBeFocused();
  }
}
