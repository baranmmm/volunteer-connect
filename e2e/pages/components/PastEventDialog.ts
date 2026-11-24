import { expect, type Page } from "@playwright/test";

/** "Add past event" (calendar) / editing a past-event record: title, date, branch, description, photos, YouTube links. */
export class PastEventDialog {
  constructor(readonly page: Page) {}

  get root() {
    return this.page.getByTestId("past-event-dialog");
  }
  readonly title = () => this.root.getByTestId("past-event-title");
  readonly date = () => this.root.getByTestId("past-event-date");
  readonly description = () => this.root.getByTestId("past-event-description");
  readonly fileInput = () => this.root.getByTestId("past-event-file-input");
  readonly photos = () => this.root.getByTestId("past-event-photo");
  readonly galleryTick = (index: number) => this.photos().nth(index).getByTestId("past-event-photo-gallery");
  readonly videoUrl = () => this.root.getByTestId("past-event-video-url");
  readonly addVideoButton = () => this.root.getByTestId("past-event-video-add");
  readonly videos = () => this.root.getByTestId("past-event-video");
  readonly saveButton = () => this.root.getByTestId("past-event-save");
  readonly error = () => this.root.getByTestId("past-event-error");

  async addPhoto(name: string, buffer: Buffer, mimeType = "image/png") {
    const before = await this.photos().count();
    await this.fileInput().setInputFiles({ name, mimeType, buffer });
    await expect(this.photos()).toHaveCount(before + 1);
  }
  async addVideo(url: string) {
    const before = await this.videos().count();
    await this.videoUrl().fill(url);
    await this.addVideoButton().click();
    await expect(this.videos()).toHaveCount(before + 1);
  }
  async save() {
    await this.saveButton().click();
    await expect(this.root).toBeHidden({ timeout: 30_000 });
  }
}
