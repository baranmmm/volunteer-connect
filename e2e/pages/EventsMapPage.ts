import { expect, type Locator, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";
import { RegionsPage } from "./RegionsPage";

/** The public events map (/events and the landing section): markers, cards, timeline and the Online panel. */
export class EventsMapPage {
  constructor(private readonly page: Page) {}

  /** Tiles are never fetched in tests (OpenStreetMap and CARTO are served empty images). */
  async blockTiles() {
    await RegionsPage.blockMapTiles(this.page);
  }

  map(): Locator {
    return this.page.getByTestId("events-map");
  }

  /** The marker of the place that holds this event (several events may share a place). */
  markerOf(eventId: string): Locator {
    return this.page.locator(`[data-testid="events-map-marker"][data-event-ids*="${eventId}"]`);
  }

  card(): Locator {
    return this.page.getByTestId("events-map-card");
  }

  cardItem(eventId: string): Locator {
    return this.card().locator(`[data-testid="events-map-card-item"][data-event-id="${eventId}"]`);
  }

  slider(): Locator {
    return this.page.getByTestId("events-map-timeline-slider");
  }

  onlineItem(eventId: string): Locator {
    return this.page.locator(`[data-testid="events-map-online-item"][data-event-id="${eventId}"]`);
  }

  async waitInteractive() {
    await expect(this.map()).toHaveAttribute("data-state", "interactive", { timeout: APP_LOAD_TIMEOUT });
    await expect(this.page.getByTestId("events-map-leaflet")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  /** Moves the slider with the keyboard to the month `offset` months after the timeline's first month. */
  async selectMonth(offset: number) {
    await this.slider().focus();
    await this.page.keyboard.press("Home");
    for (let i = 0; i < offset; i++) await this.page.keyboard.press("ArrowRight");
    await expect(this.slider()).toHaveAttribute("aria-valuenow", String(offset));
  }
}

/** Months from this London month to the London month of `iso` (0 = this month). */
export function monthOffset(iso: string, now = new Date()): number {
  const month = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).format(d);
  const [y1, m1] = month(now).split("-").map(Number) as [number, number];
  const [y2, m2] = month(new Date(iso)).split("-").map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
}
