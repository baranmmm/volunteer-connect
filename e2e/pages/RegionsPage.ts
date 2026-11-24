import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";

// A 1x1 transparent PNG: map tiles are never fetched from OpenStreetMap in tests.
const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Regions & branches (`/regions`): the map (default view) and the List view. */
export class RegionsPage {
  constructor(private readonly page: Page) {}

  /** Serves every OpenStreetMap tile as an empty image. Call before the map is shown. */
  static async blockMapTiles(page: Page) {
    // OpenStreetMap (no CARTO key) and CARTO Positron tiles: never loaded in tests.
    for (const pattern of ["https://tile.openstreetmap.org/**", "https://basemaps.cartocdn.com/**"])
      await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: "image/png", body: EMPTY_PNG }));
  }

  async goto() {
    await RegionsPage.blockMapTiles(this.page);
    await this.page.goto("/regions");
    await expect(this.page.getByTestId("regions-view-switch-map")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  map() {
    return this.page.getByTestId("regions-map");
  }

  marker(branchId: string) {
    return this.page.locator(`[data-testid="regions-map-marker"][data-branch-id="${branchId}"]`);
  }

  markers() {
    return this.page.getByTestId("regions-map-marker");
  }

  panel() {
    return this.page.getByTestId("regions-map-panel");
  }

  async showList() {
    await this.page.getByTestId("regions-view-switch-list").click({ timeout: APP_LOAD_TIMEOUT });
    await expect(this.page.getByTestId("regions-tree")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }
}
