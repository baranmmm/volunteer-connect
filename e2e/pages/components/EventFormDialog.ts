import { expect, type Page } from "@playwright/test";
import { pickOption } from "./select";

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type RepeatEnds = "never" | "on" | "after";
/** Collapsible sections of the form; all start collapsed every time the form opens. */
export type EventFormSection = "description" | "registration" | "audience" | "files" | "repeat";
export type MeetingRepeatFreq = "none" | "weekly" | "monthly";

/**
 * The create/edit event form (EventForm), including the repeat controls. Title, category, date/time and place are
 * always visible; open a section (openSection) before using its fields (capacity, audience, files, repeat, ...).
 * With the category "meeting" it becomes the meeting form (invitees, meeting repeat).
 */
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
  readonly category = () => this.root.getByTestId("event-form-category");
  readonly invitees = () => this.root.getByTestId("event-form-invitees");
  readonly meetingRepeatCount = () => this.root.getByTestId("event-form-meeting-repeat-count");
  section(name: EventFormSection) {
    return this.root.getByTestId(`event-form-section-${name}`);
  }
  sectionToggle(name: EventFormSection) {
    return this.root.getByTestId(`event-form-section-${name}-toggle`);
  }

  /** Expands a section (no-op when it is already open). */
  async openSection(name: EventFormSection) {
    const toggle = this.sectionToggle(name);
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  async chooseCategory(category: string) {
    await pickOption(this.page, "event-form-category", "event-form-category-option", category);
  }
  /** Meeting form: picks an invitee in the people combobox by user id. */
  async invite(userId: string) {
    await this.root.getByTestId("event-form-invitees-open").click();
    await this.page.locator(`[data-testid="event-form-invitees-option"][data-user-id="${userId}"]`).click();
    await this.page.keyboard.press("Escape");
    await expect(this.invitees().locator(`[data-testid="event-form-invitees-chip"][data-user-id="${userId}"]`)).toBeVisible();
  }
  /** Meeting form: repeat weekly/monthly every `interval`, `count` occurrences. */
  async meetingRepeat(freq: MeetingRepeatFreq, interval = 1, count?: number) {
    await this.openSection("repeat");
    await pickOption(this.page, "event-form-meeting-repeat-freq", "event-form-meeting-repeat-freq-option", freq);
    if (freq === "none") return;
    await pickOption(this.page, "event-form-meeting-repeat-interval", "event-form-meeting-repeat-interval-option", String(interval));
    if (count !== undefined) await this.meetingRepeatCount().fill(String(count));
  }

  async chooseTime(side: "start" | "end", time: string) {
    await pickOption(this.page, `event-form-${side}-time`, `event-form-${side}-time-option`, time);
  }
  /** Fills the date and picks the time; `local` is "YYYY-MM-DDTHH:mm". */
  async setStart(local: string) {
    await this.startDate().fill(local.slice(0, 10));
    await this.chooseTime("start", local.slice(11, 16));
  }

  async chooseRepeat(freq: RepeatFreq) {
    await this.openSection("repeat");
    await pickOption(this.page, "event-form-repeat", "event-form-repeat-option", freq);
  }
  async chooseEnds(ends: RepeatEnds) {
    await this.openSection("repeat");
    await pickOption(this.page, "event-form-repeat-ends", "event-form-repeat-ends-option", ends);
  }

  async publish() {
    await this.publishButton().click();
    await expect(this.root).toBeHidden({ timeout: 20_000 });
  }
}
