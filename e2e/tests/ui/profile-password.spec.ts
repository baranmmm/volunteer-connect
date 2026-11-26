// Profile > Change password, and the logo as the home link. Passwords are typed only into fields whose test id contains
// "password" (masked in traces and reports) and are never printed or put into assertion messages.
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import { anonClient } from "../../api/SupabaseClient";
import { AuthPage } from "../../pages/AuthPage";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { userPassword } from "../../setup/env";

/** Whether a password signs in (a throwaway client; the result only, never the value). */
async function signsIn(email: string, password: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) await client.auth.signOut({ scope: "local" });
  return !error;
}

async function openForm(page: Page) {
  await page.goto("/profile");
  const toggle = page.getByTestId("profile-password-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false", { timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByTestId("profile-password-current")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test.describe("Change password", () => {
  test("wrong current password is refused; mismatch and weak are caught; the change works and the new password signs in", { tag: "@smoke" }, async ({ freshUser, pageAs }) => {
    const user = await freshUser();
    const page = await pageAs(user);
    const next = `${userPassword()}-Nw7`;
    await openForm(page);
    await expect(page.getByTestId("profile-password-sign-out-others")).toBeChecked();

    // Mismatch and too short: caught in the form, nothing is sent.
    await page.getByTestId("profile-password-current").fill(userPassword());
    await page.getByTestId("profile-password-new").fill("short");
    await page.getByTestId("profile-password-confirm").fill("other");
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("profile-password-new-error")).toBeVisible();
    await expect(page.getByTestId("profile-password-confirm-error")).toBeVisible();

    // Wrong current password: refused, the password is unchanged.
    await page.getByTestId("profile-password-current").fill(`${userPassword()}-wrong`);
    await page.getByTestId("profile-password-new").fill(next);
    await page.getByTestId("profile-password-confirm").fill(next);
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("profile-password-current-error")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("profile-password-current")).toHaveAttribute("aria-invalid", "true");
    expect(await signsIn(user.email, userPassword())).toBe(true);

    // Right current password: changed; the old one no longer signs in, the new one does.
    await page.getByTestId("profile-password-current").fill(userPassword());
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("profile-password-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(await signsIn(user.email, userPassword())).toBe(false);
    expect(await signsIn(user.email, next)).toBe(true);

    // And through the sign-in page.
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    const auth = new AuthPage(page);
    await auth.goto();
    await auth.signIn(user.email, next);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: APP_LOAD_TIMEOUT });
  });
});

test.describe("Change password — National Coordinator", () => {
  test("an NC (aal2 session) changes the password; the MFA step stays required for signing in", async ({ freshUser, pageAs }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const page = await pageAs(nc);
    const next = `${userPassword()}-Nc9`;
    await openForm(page);
    await page.getByTestId("profile-password-current").fill(userPassword());
    await page.getByTestId("profile-password-new").fill(next);
    await page.getByTestId("profile-password-confirm").fill(next);
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    // The new password signs in, but only to aal1: the authenticator is still required.
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email: nc.email, password: next });
    expect(error).toBeNull();
    const level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(level.data).toMatchObject({ currentLevel: "aal1", nextLevel: "aal2" });
    await client.auth.signOut({ scope: "local" });
  });
});

test.describe("Logo link", () => {
  test("the logo goes home: /dashboard when signed in (mouse and keyboard), / when signed out", async ({ page, freshUser, pageAs }) => {
    const member = await pageAs(await freshUser());
    await member.goto("/tasks");
    const logo = member.getByTestId("logo-home-link").filter({ visible: true });
    await expect(logo).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(logo).toHaveAttribute("data-target", "/dashboard");
    await expect(logo).toHaveAccessibleName(/.+/);
    await logo.click();
    await expect(member).toHaveURL(/\/dashboard$/);
    await member.goto("/profile");
    await logo.focus();
    await member.keyboard.press("Enter");
    await expect(member).toHaveURL(/\/dashboard$/);

    // Signed out (public privacy page): / (the join page).
    await page.goto("/privacy");
    const out = page.getByTestId("logo-home-link").filter({ visible: true });
    await expect(out).toHaveAttribute("data-target", "/", { timeout: APP_LOAD_TIMEOUT });
    await out.click();
    await expect(page.getByTestId("auth-sign-up-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/$/);
  });
});
