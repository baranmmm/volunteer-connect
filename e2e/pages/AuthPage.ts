import { expect, type Page } from "@playwright/test";

export class AuthPage {
  constructor(readonly page: Page) {}

  readonly email = () => this.page.getByTestId("auth-email-input");
  readonly password = () => this.page.getByTestId("auth-password-input");
  readonly submit = () => this.page.getByTestId("auth-submit-button");
  readonly forgotLink = () => this.page.getByTestId("auth-forgot-password-link");
  readonly toggleMode = () => this.page.getByTestId("auth-toggle-mode-link");
  readonly signInForm = () => this.page.getByTestId("auth-sign-in-form");
  readonly signUpForm = () => this.page.getByTestId("auth-sign-up-form");
  readonly forgotForm = () => this.page.getByTestId("auth-forgot-form");
  readonly checkEmailScreen = () => this.page.getByTestId("auth-check-email-screen");
  readonly resetSentMessage = () => this.page.getByTestId("auth-reset-sent-message");
  readonly backToSignIn = () => this.page.getByTestId("auth-back-to-sign-in-button");

  async goto() {
    await this.page.goto("/auth");
    await expect(this.signInForm()).toBeVisible();
  }

  async signIn(email: string, password: string) {
    const form = this.signInForm();
    await form.getByTestId("auth-email-input").fill(email);
    await form.getByTestId("auth-password-input").fill(password);
    await form.getByTestId("auth-submit-button").click();
  }
}
