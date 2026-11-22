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
  /** Timed Start/End: a date input plus a quarter-hour time list (London wall clock). */
  readonly startDate = () => this.root.getByTestId("event-form-start-date");
  readonly startTime = () => this.root.getByTestId("event-form-start-time");
  readonly endDate = () => this.root.getByTestId("event-form-end-date");
  readonly endTime = () => this.root.getByTestId("event-form-end-time");
  /** An option of an open time list, e.g. timeOption("start", "18:00"). */
  timeOption(side: "start" | "end", time: string) {
    return this.page.getByTestId(`event-form-${side}-time-option-${time}`);
  }
  readonly repeat = () => this.root.getByTestId("event-form-repeat");
  readonly repeatEnds = () => this.root.getByTestId("event-form-repeat-ends");
  readonly repeatCount = () => this.root.getByTestId("event-form-repeat-count");
  readonly repeatUntil = () => this.root.getByTestId("event-form-repeat-until");
  readonly summary = () => this.root.getByTestId("event-repeat-summary");
  readonly publishButton = () => this.root.getByTestId("event-form-publish");
  readonly capacity = () => this.root.getByTestId("event-form-capacity");
  readonly registrationEnabled = () => this.root.getByTestId("event-form-registration-enabled");

  async chooseTime(side: "start" | "end", time: string) {
    await pickOption(this.page, `event-form-${side}-time`, `event-form-${side}-time-option`, time);
  }
  /** Fills the date and picks the time; `local` is "YYYY-MM-DDTHH:mm". */
  async setStart(local: string) {
    await this.startDate().fill(local.slice(0, 10));
    await this.chooseTime("start", local.slice(11, 16));
  }

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
