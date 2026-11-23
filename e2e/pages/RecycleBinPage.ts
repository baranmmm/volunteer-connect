import { expect, type Locator, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";

/** /recycle-bin: deleted events and users within the manager's branch or region. */
export class RecycleBinPage {
  constructor(readonly page: Page) {}

  readonly table = () => this.page.getByTestId("recycle-bin-table");
  readonly search = () => this.page.getByTestId("recycle-bin-search");
  readonly rows = () => this.page.getByTestId("recycle-bin-row");

  row(itemId: string): Locator {
    return this.page.locator(`[data-testid="recycle-bin-row"][data-item-id="${itemId}"]`);
  }
  restoreButton(itemId: string) {
    return this.row(itemId).getByTestId("recycle-bin-restore");
  }
  permanentDeleteButton(itemId: string) {
    return this.row(itemId).getByTestId("recycle-bin-delete-permanently");
  }
  scheduledErasure(itemId: string) {
    return this.row(itemId).getByTestId("recycle-bin-scheduled-erasure");
  }

  async goto() {
    await this.page.goto("/recycle-bin");
    await expect(this.table()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  /** Narrows the list to one item by searching its (unique) title. */
  async find(itemId: string, title: string) {
    await this.search().fill(title);
    await expect(this.row(itemId)).toBeVisible();
  }

  async restore(itemId: string) {
    await this.restoreButton(itemId).click();
    await expect(this.row(itemId)).toHaveCount(0);
  }
}
