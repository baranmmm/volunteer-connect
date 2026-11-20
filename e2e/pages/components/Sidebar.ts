import { expect, type Page } from "@playwright/test";

export type NavKey = "dashboard" | "calendar" | "tasks" | "meetings" | "media" | "training" | "contacts" | "approvals" | "users" | "profile";
const MOBILE_PRIMARY: NavKey[] = ["dashboard", "calendar", "tasks", "meetings"];

/** Desktop sidebar or mobile bottom nav + "More" sheet, depending on the project. */
export class Sidebar {
  constructor(private readonly page: Page, private readonly isMobile: boolean) {}

  /** The visible nav link (desktop and mobile navs both exist in the DOM). */
  link(key: NavKey) {
    return this.page.getByTestId(`nav-${key}`).filter({ visible: true });
  }

  private async openMoreIfNeeded(key: NavKey | "sign-out") {
    if (this.isMobile && !MOBILE_PRIMARY.includes(key as NavKey)) {
      await this.page.getByTestId("mobile-nav-more").click();
    }
  }

  async go(key: NavKey) {
    await this.openMoreIfNeeded(key);
    await this.link(key).click();
    await expect(this.page).toHaveURL(new RegExp(`/${key}(?:$|[/?#])`));
  }

  /** Whether a manager-only item is offered to this user (checks the right nav for the device). */
  async hasItem(key: NavKey): Promise<boolean> {
    await this.openMoreIfNeeded(key);
    const visible = (await this.link(key).count()) > 0;
    if (this.isMobile && !MOBILE_PRIMARY.includes(key)) await this.page.keyboard.press("Escape");
    return visible;
  }

  async signOut() {
    await this.openMoreIfNeeded("sign-out");
    await this.page.getByTestId("nav-sign-out").filter({ visible: true }).click();
    await expect(this.page).toHaveURL(/\/auth$/);
  }
}
