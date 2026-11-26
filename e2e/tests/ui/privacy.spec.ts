// Privacy notice in the UI: sign-up confirmation and optional consents, the confirmation screen, /privacy, Profile.
import { randomUUID } from "node:crypto";
import { test, expect } from "../../fixtures/roles";
import { adminClient, deleteAuthUser, listAllUsers } from "../../api/SupabaseClient";
import { FRESH_PREFIX, readSeedState } from "../../data/users";
import { emailDomain, userPassword } from "../../setup/env";
import { AuthPage } from "../../pages/AuthPage";

test.describe("Privacy notice", () => {
  test("/privacy opens without signing in and shows the notice with its tables", async ({ browser }) => {
    const context = await browser.newContext(); // no session
    const page = await context.newPage();
    await page.goto("/privacy");
    await expect(page.getByTestId("privacy-page")).toBeVisible();
    await expect(page.getByTestId("privacy-notice").locator("table")).toHaveCount(2);
    await expect(page.getByTestId("privacy-notice").locator('th[scope="col"]').first()).toBeVisible();
    // The page shows the version the database requires (privacy_notice_version(), now 1.3).
    const { data: version } = await adminClient().rpc("privacy_notice_version");
    await expect(page.getByTestId("privacy-notice").locator("p").first()).toContainText(`${version} ·`);
    await context.close();
  });

  test("sign-up needs the confirmation; the optional consents are off by default and saved when ticked", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const address = `${FRESH_PREFIX}${process.env["E2E_RUN_ID"] ?? "local"}-signup-${randomUUID().slice(0, 8)}@${emailDomain()}`;
    try {
      const auth = new AuthPage(page);
      await auth.goto();
      await auth.toggleMode().click();
      await expect(auth.signUpForm()).toBeVisible();
      await page.getByTestId("auth-full-name-input").fill("E2E Privacy Signup");
      await page.getByTestId("auth-email-input").fill(address);
      await page.getByTestId("auth-phone-input").fill("07000000000");
      await page.getByTestId("auth-password-input").fill(userPassword());
      await page.getByTestId("auth-confirm-password-input").fill(userPassword());
      await page.getByTestId("signup-branch-select").selectOption(readSeedState().branches.Medway);
      await page.getByTestId("signup-choice-follower").click();
      // Photos at events are covered by the notice (1.6): no photo consent is asked.
      await expect(page.getByTestId("signup-photo-consent")).toHaveCount(0);
      await expect(page.getByTestId("signup-updates-consent")).not.toBeChecked();
      await auth.submit().click();
      await expect(page.locator("#signup-privacy-error")).toBeVisible();
      await expect(auth.signUpForm()).toBeVisible();
      // QA's Auth does not accept public sign-ups for test addresses, so the request is captured here; the server
      // side (handle_new_user refusing accounts without the current version) is covered by tests/api/privacy.spec.ts.
      let sent: { data?: Record<string, unknown> } | null = null;
      await page.route("**/auth/v1/signup**", async (route) => {
        sent = route.request().postDataJSON() as { data?: Record<string, unknown> };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: randomUUID(), email: address, user_metadata: sent.data ?? {} }) });
      });
      await page.getByTestId("signup-privacy-checkbox").click();
      await page.getByTestId("signup-updates-consent").click();
      await auth.submit().click();
      await expect(auth.checkEmailScreen()).toBeVisible();
      const { data: version } = await adminClient().rpc("privacy_notice_version");
      expect(sent!.data).toMatchObject({ privacy_notice_version: version, updates_email_consent: true });
      expect(sent!.data).not.toHaveProperty("photo_consent");
    } finally {
      const user = (await listAllUsers()).find((u) => u.email?.toLowerCase() === address.toLowerCase());
      if (user) await deleteAuthUser(user.id);
      await context.close();
    }
  });

  test("a member without the current confirmation sees the confirmation screen first, then the app; Profile shows it", { tag: "@smoke" }, async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    await adminClient().from("privacy_notice_acceptances").update({ notice_version: "0.9" }).eq("user_id", volunteer.id);
    const page = await pageAs(volunteer);
    await page.goto("/dashboard");
    const gate = page.getByTestId("privacy-gate");
    await expect(gate).toBeVisible();
    await expect(page.getByTestId("dashboard-welcome")).toHaveCount(0);
    await expect(page.getByTestId("privacy-gate-accept")).toBeDisabled();
    await page.getByTestId("privacy-gate-read").click();
    await page.getByTestId("privacy-gate-accept").click();
    await expect(page.getByTestId("dashboard-welcome")).toBeVisible();
    await page.goto("/profile");
    await expect(page.getByTestId("profile-privacy-version")).toHaveAttribute("data-version", /^\d+\.\d+$/);
    await expect(page.getByTestId("profile-photo-consent")).toHaveCount(0);
    await page.getByTestId("profile-updates-consent").click();
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("profile-updates-consent")).toHaveAttribute("data-state", "checked");
  });

  test("a member who does not want to confirm can ask for account deletion from the confirmation screen, and cancel it", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    await adminClient().from("privacy_notice_acceptances").delete().eq("user_id", volunteer.id);
    const page = await pageAs(volunteer);
    await page.goto("/dashboard");
    await expect(page.getByTestId("privacy-gate")).toBeVisible();
    await page.getByTestId("privacy-gate-delete-account").click();
    const dialog = page.getByTestId("profile-delete-confirm-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("confirm-dialog-confirm-button").click();
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    await expect(page.getByTestId("privacy-gate-deletion-pending")).toBeVisible();
    const pending = await adminClient().from("account_deletion_requests").select("status").eq("user_id", volunteer.id).eq("status", "pending");
    expect(pending.data).toHaveLength(1);
    // Still behind the confirmation screen.
    await expect(page.getByTestId("dashboard-welcome")).toHaveCount(0);
    await page.getByTestId("privacy-gate-cancel-deletion").click();
    await expect(page.getByTestId("privacy-gate-delete-account")).toBeVisible();
    const after = await adminClient().from("account_deletion_requests").select("status").eq("user_id", volunteer.id).eq("status", "pending");
    expect(after.data).toEqual([]);
  });

  test("directors get no deletion link on the confirmation screen (they cannot be deleted in-app)", async ({ freshUser, pageAs }) => {
    const director = await freshUser({ role: "regional_director" });
    await adminClient().from("privacy_notice_acceptances").delete().eq("user_id", director.id);
    const page = await pageAs(director);
    await page.goto("/dashboard");
    await expect(page.getByTestId("privacy-gate")).toBeVisible();
    await expect(page.getByTestId("privacy-gate-signout")).toBeVisible();
    await expect(page.getByTestId("privacy-gate-delete-account")).toHaveCount(0);
  });

  test("signing out from the confirmation screen", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    await adminClient().from("privacy_notice_acceptances").delete().eq("user_id", volunteer.id);
    const page = await pageAs(volunteer);
    await page.goto("/dashboard");
    await page.getByTestId("privacy-gate-signout").click();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("the notice is shown in Turkish (same version) when the app is in Turkish", async ({ freshUser, pageAs }) => {
    const page = await pageAs(await freshUser({ language: "tr" }), { language: "tr" });
    await page.goto("/privacy");
    const notice = page.getByTestId("privacy-notice");
    await expect(notice).toHaveAttribute("data-lang", "tr", { timeout: 30_000 });
    await expect(notice).toHaveAttribute("lang", "tr");
    await expect(notice.locator("table")).toHaveCount(2);
    const { data: version } = await adminClient().rpc("privacy_notice_version");
    await expect(notice.locator("p").first()).toContainText(`${version} ·`);
  });
});
