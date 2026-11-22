import { expect, type Page } from "@playwright/test";
import { pickOption } from "./select";

/** The "Request an event" form (EventRequestForm). */
export class EventRequestFormDialog {
  constructor(readonly page: Page) {}

  get root() {
    return this.page.getByTestId("event-request-form");
  }
  readonly scope = () => this.root.getByTestId("event-request-form-scope");
  readonly title = () => this.root.getByTestId("event-request-form-title");
  readonly description = () => this.root.getByTestId("event-request-form-description");
  readonly allDay = () => this.root.getByTestId("event-request-form-all-day");
  readonly startDate = () => this.root.getByTestId("event-request-form-start-date");
  readonly startTime = () => this.root.getByTestId("event-request-form-start-time");
  readonly endDate = () => this.root.getByTestId("event-request-form-end-date");
  readonly endTime = () => this.root.getByTestId("event-request-form-end-time");
  readonly addAlternative = () => this.root.getByTestId("event-request-form-add-alternative");
  readonly location = () => this.root.getByTestId("event-request-form-location");
  readonly online = () => this.root.getByTestId("event-request-form-online");
  readonly onlineUrl = () => this.root.getByTestId("event-request-form-online-url");
  readonly expectedAttendees = () => this.root.getByTestId("event-request-form-expected-attendees");
  readonly reason = () => this.root.getByTestId("event-request-form-reason");
  readonly submitButton = () => this.root.getByTestId("event-request-form-submit");
  readonly error = () => this.root.getByTestId("event-request-form-error");
  /** Inline field error, e.g. fieldError("start"). */
  readonly fieldError = (key: string) => this.root.locator(`#event-request-form-${key}-error`);

  /** Timed value: date input + quarter-hour list; `local` is London "YYYY-MM-DDTHH:mm". */
  async setDateTime(key: "start" | "end" | "alt-start" | "alt-end", local: string) {
    await this.root.getByTestId(`event-request-form-${key}-date`).fill(local.slice(0, 10));
    await pickOption(this.page, `event-request-form-${key}-time`, `event-request-form-${key}-time-option`, local.slice(11, 16));
  }

  async submit() {
    await this.submitButton().click();
    await expect(this.root).toBeHidden({ timeout: 20_000 });
  }
}
