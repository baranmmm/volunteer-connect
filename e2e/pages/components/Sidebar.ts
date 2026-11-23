import { expect, type Locator, type Page } from "@playwright/test";

export type NavKey = "dashboard" | "calendar" | "tasks" | "meetings" | "media" | "training" | "contacts" | "approvals" | "my-requests" | "requests" | "users" | "profile";
const MOBILE_PRIMARY: NavKey[] = ["dashboard", "calendar", "tasks", "meetings"];

/** Desktop sidebar (`app-sidebar`) or mobile bottom nav (`mobile-bottom-nav`) + "More" sheet (`mobile-nav-more-sheet`). */
export class Sidebar {
  constructor(private readonly page: Page, private readonly isMobile: boolean) {}

  private get desktopNav() {
    return this.page.getByTestId("app-sidebar");
  }
  private get bottomNav() {
    return this.page.getByTestId("mobile-bottom-nav");
  }
  private get moreSheet() {
    return this.page.getByTestId("mobile-nav-more-sheet");
  }

  private inMore(key: NavKey) {
    return this.isMobile && !MOBILE_PRIMARY.includes(key);
  }

  private async openMore() {
    await this.page.getByTestId("mobile-nav-more").click();
    await expect(this.moreSheet).toBeVisible();
  }

  /** Waits for the close animation: the modal overlay swallows clicks until the sheet is gone. */
  private async closeMore() {
    await this.page.keyboard.press("Escape");
    await expect(this.moreSheet).toBeHidden();
  }

  /** The nav container that holds this item on the current device. */
  private container(key: NavKey): Locator {
    if (!this.isMobile) return this.desktopNav;
    return this.inMore(key) ? this.moreSheet : this.bottomNav;
  }

  link(key: NavKey) {
    return this.container(key).getByTestId(`nav-${key}`);
  }

  /** Pending-request count next to "Requests" (absent at zero); opens the More sheet on phones. */
  async requestsBadge(): Promise<Locator> {
    if (this.inMore("requests")) await this.openMore();
    return this.link("requests").getByTestId("nav-requests-badge");
  }

  async go(key: NavKey) {
    if (this.inMore(key)) await this.openMore();
    await this.link(key).click();
    await expect(this.page).toHaveURL(new RegExp(`/${key}(?:$|[/?#])`));
  }

  /** Whether a manager-only item is offered to this user (checks the right nav for the device). */
  async hasItem(key: NavKey): Promise<boolean> {
    if (this.inMore(key)) await this.openMore();
    else await expect(this.container(key)).toBeVisible();
    const present = (await this.link(key).count()) > 0;
    if (this.inMore(key)) await this.closeMore();
    return present;
  }

  async signOut() {
    if (this.isMobile) {
      await this.openMore();
      await this.moreSheet.getByTestId("mobile-nav-sign-out").click();
    } else {
      await this.desktopNav.getByTestId("nav-sign-out").click();
    }
    await expect(this.page).toHaveURL(/\/auth$/);
  }
}
