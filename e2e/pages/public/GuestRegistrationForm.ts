import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "../app";

/** The guest (no account) registration form on the signed-out public event page (/events/:id). */
export class GuestRegistrationForm {
  constructor(readonly page: Page) {}

  readonly form = () => this.page.getByTestId("guest-form");
  readonly name = () => this.page.getByTestId("guest-form-name");
  readonly email = () => this.page.getByTestId("guest-form-email");
  readonly phone = () => this.page.getByTestId("guest-form-phone");
  readonly places = () => this.page.getByTestId("guest-form-places");
  readonly keepInformed = () => this.page.getByTestId("guest-form-keep-informed");
  readonly honeypot = () => this.page.getByTestId("guest-form-honeypot");
  readonly privacyLink = () => this.page.getByTestId("guest-form-privacy-link");
  readonly submit = () => this.page.getByTestId("guest-form-submit");
  readonly sent = () => this.page.getByTestId("guest-form-sent");
  readonly error = () => this.page.getByTestId("guest-form-error");

  async goto(eventId: string) {
    await this.page.goto(`/events/${eventId}`);
    await expect(this.form()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  async fill(guest: { name: string; email: string; phone?: string; keepInformed?: boolean }) {
    await this.name().fill(guest.name);
    await this.email().fill(guest.email);
    if (guest.phone) await this.phone().fill(guest.phone);
    if (guest.keepInformed) await this.keepInformed().click();
  }

  /** Fills and submits; the form always answers "check your email". */
  async register(guest: { name: string; email: string; phone?: string; keepInformed?: boolean }) {
    await this.fill(guest);
    await this.submit().click();
    await expect(this.sent()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }
}
