import { expect, type Page } from "@playwright/test";
import { pickOption } from "./select";

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type RepeatEnds = "never" | "on" | "after";

/** The create/edit event form (EventForm), including the repeat controls. */
export class EventFormDialog {
  constructor(readonly page: Page) {}

  get root() {
    return this.page.getByTestId("event-form");
  }
  readonly title = () => this.root.getByTestId("event-form-title");
  readonly location = () => this.root.getByTestId("event-form-location");
  /** datetime-local, London wall clock "YYYY-MM-DDTHH:mm". */
  readonly start = () => this.root.getByTestId("event-form-start");
  readonly end = () => this.root.getByTestId("event-form-end");
  readonly repeat = () => this.root.getByTestId("event-form-repeat");
  readonly repeatEnds = () => this.root.getByTestId("event-form-repeat-ends");
  readonly repeatCount = () => this.root.getByTestId("event-form-repeat-count");
  readonly repeatUntil = () => this.root.getByTestId("event-form-repeat-until");
  readonly summary = () => this.root.getByTestId("event-repeat-summary");
  readonly publishButton = () => this.root.getByTestId("event-form-publish");

  async chooseRepeat(freq: RepeatFreq) {
    await pickOption(this.page, "event-form-repeat", "event-form-repeat-option", freq);
  }
  async chooseEnds(ends: RepeatEnds) {
    await pickOption(this.page, "event-form-repeat-ends", "event-form-repeat-ends-option", ends);
  }

  async publish() {
    await this.publishButton().click();
    await expect(this.root).toBeHidden({ timeout: 20_000 });
  }
}
