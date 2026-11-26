import { expect, type Locator, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";

/**
 * The public events map story on /events: the fixed dotted map of the United Kingdom (branch dots), the active
 * event's card, the timeline (one tick per event, cursor, Today) and Play.
 */
export class EventsMapPage {
  constructor(private readonly page: Page) {}

  /** The tall scroll section; data-active is the event index, data-mode "story" or "static" (reduced motion). */
  story(): Locator {
    return this.page.getByTestId("events-map");
  }

  /** The map's fixed box (its data-frame is the SVG frame). */
  canvas(): Locator {
    return this.page.getByTestId("events-map-canvas");
  }

  branch(branchId: string): Locator {
    return this.page.locator(`[data-testid="events-map-branch"][data-branch-id="${branchId}"]`);
  }

  activeBranches(): Locator {
    return this.page.locator('[data-testid="events-map-branch"][data-active="true"]');
  }

  /** The visible card (desktop: next to the dot; phones: below the map). */
  card(): Locator {
    return this.page.locator('[data-testid="events-map-card"]:visible');
  }

  ticks(): Locator {
    return this.page.getByTestId("events-map-timeline-tick");
  }

  tick(eventId: string): Locator {
    return this.page.locator(`[data-testid="events-map-timeline-tick"][data-event-id="${eventId}"]`);
  }

  slider(): Locator {
    return this.page.getByTestId("events-map-timeline-slider");
  }

  play(): Locator {
    return this.page.getByTestId("events-map-timeline-play");
  }

  async waitReady(mode: "story" | "static" = "story") {
    await expect(this.story()).toHaveAttribute("data-mode", mode, { timeout: APP_LOAD_TIMEOUT });
  }

  /** The step index of an event (its tick's position). */
  async indexOf(eventId: string): Promise<number> {
    return Number(await this.tick(eventId).getAttribute("data-index"));
  }

  /** Selects an event with the keyboard on the timeline (exact even when ticks crowd on a phone). */
  async selectByKeyboard(eventId: string) {
    const target = await this.indexOf(eventId);
    await this.slider().focus();
    await this.page.keyboard.press("Home");
    for (let i = 0; i < target; i++) await this.page.keyboard.press("ArrowRight");
    await expect(this.story()).toHaveAttribute("data-active", String(target));
  }
}
