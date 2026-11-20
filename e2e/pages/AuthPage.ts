import { expect, type Page } from "@playwright/test";

export class AuthPage {
  constructor(readonly page: Page) {}

  readonly email = () => this.page.getByTestId("auth-email-input");
  readonly password = () => this.page.getByTestId("auth-password-input");
  readonly submit = () => this.page.getByTestId("auth-submit-button");
  readonly forgotLink = () => this.page.getByTestId("auth-forgot-password-link");
  readonly toggleMode = () => this.page.getByTestId("auth-toggle-mode-link");

  async goto() {
    await this.page.goto("/auth");
    await expect(this.submit()).toBeVisible();
  }

  async signIn(email: string, password: string) {
    await this.email().fill(email);
    await this.password().fill(password);
    await this.submit().click();
  }
}
