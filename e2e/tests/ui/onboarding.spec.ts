// Sign-in and join pages (photo layout at desktop and 390 px), follower vs volunteer at sign-up, the welcome screen,
// the follower status strip on the dashboard and the role explanation in the profile.
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { test, expect, type TestUser } from "../../fixtures/roles";
import { adminClient, deleteAuthUser } from "../../api/SupabaseClient";
import { rpcAs } from "../../api/eventRequests";
import { FRESH_PREFIX } from "../../data/users";
import { emailDomain, userPassword } from "../../setup/env";
import { AuthPage } from "../../pages/AuthPage";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

const HELP = "I would like to help set up dialogue dinners and welcome guests.";

async function branchName(id: string) {
  const { data } = await adminClient().from("branches").select("name").eq("id", id).single();
  return (data as { name: string }).name;
}

async function expectNoSeriousViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), label).toEqual([]);
}

/** Opens the join form and fills the account fields (not the choice, not the privacy confirmation). */
async function openJoin(page: Page, email: string, branchId: string) {
  await page.goto("/auth?mode=signup");
  const auth = new AuthPage(page);
  await expect(auth.signUpForm()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await page.getByTestId("auth-full-name-input").fill("E2E Onboarding Signup");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-phone-input").fill("07000000000");
  await page.getByTestId("auth-password-input").fill(userPassword());
  await page.getByTestId("auth-confirm-password-input").fill(userPassword());
  await page.getByTestId("signup-branch-select").selectOption(branchId);
  await page.getByTestId("signup-privacy-checkbox").click();
  return auth;
}

/** Captures the sign-up request instead of sending it (QA's Auth refuses public sign-ups of test addresses). */
async function captureSignUp(page: Page, email: string) {
  const sent: { data?: Record<string, unknown> }[] = [];
  await page.route("**/auth/v1/signup**", async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: Record<string, unknown> };
    sent.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: randomUUID(), email, user_metadata: body.data ?? {} }) });
  });
  return sent;
}

const freshAddress = (label: string) => `${FRESH_PREFIX}${process.env["E2E_RUN_ID"] ?? "local"}-${label}-${randomUUID().slice(0, 8)}@${emailDomain()}`;

test.describe("Sign-in and join pages", () => {
  test("photo beside the form on desktop, a banner above it at 390 px; the visible photo loads first; no serious axe issues", async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const auth = new AuthPage(page);
      await auth.goto();
      const image = page.getByTestId("auth-hero-image");
      await expect(image).toHaveAttribute("data-image", "signin");
      await expect(image).toHaveAttribute("fetchpriority", "high");
      await expect(image).toHaveAttribute("loading", "eager");
      await expect(page.getByTestId("auth-signin-welcome")).toBeVisible();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const photo = (await image.boundingBox())!;
      const form = (await auth.signInForm().boundingBox())!;
      if (viewport.width > 1000) {
        expect(photo.x + photo.width).toBeLessThanOrEqual(form.x);
        expect(photo.width).toBeGreaterThan(viewport.width * 0.5);
      } else {
        expect(photo.y + photo.height).toBeLessThanOrEqual(form.y);
        expect(photo.height).toBeLessThan(260);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await expectNoSeriousViolations(page, `sign-in ${viewport.width}`);

      await auth.toggleMode().click();
      await expect(auth.signUpForm()).toBeVisible();
      await expect(page.getByTestId("auth-hero-image")).toHaveAttribute("data-image", "join");
      await expect(page.getByTestId("auth-hero-image")).toHaveCount(1);
      await expect(page.getByTestId("auth-join-intro").locator("li")).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.getByTestId("signup-choice-volunteer").click();
      await expectNoSeriousViolations(page, `join ${viewport.width}`);
    }
  });

  test("join: no default choice; the volunteer answers are required; the follower choice sends no application", async ({ page, seed }) => {
    const email = freshAddress("follower-choice");
    const sent = await captureSignUp(page, email);
    const auth = await openJoin(page, email, seed.branches.Medway);
    for (const choice of ["follower", "volunteer"]) await expect(page.getByTestId(`signup-choice-${choice}`)).toHaveAttribute("data-state", "unchecked");
    await auth.submit().click();
    await expect(page.getByTestId("signup-choice-error")).toBeVisible();

    await page.getByTestId("signup-choice-volunteer").click();
    await expect(page.getByTestId("signup-choice-error")).toHaveCount(0);
    await page.getByTestId("signup-volunteer-help").fill("Too short to count.");
    await auth.submit().click();
    for (const field of ["help", "time", "commitment"]) await expect(page.getByTestId(`signup-volunteer-${field}-error`)).toBeVisible();
    await expect(page.getByTestId("signup-volunteer-help")).toHaveAttribute("aria-describedby", /signup-volunteer-help-error/);
    expect(sent).toHaveLength(0);

    await page.getByTestId("signup-choice-follower").click();
    await expect(page.getByTestId("signup-volunteer-answers")).toHaveCount(0);
    await auth.submit().click();
    await expect(auth.checkEmailScreen()).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ branch_id: seed.branches.Medway });
    expect(sent[0]!.data).not.toHaveProperty("volunteer_application");
  });

  test("join as a volunteer: the welcome screen says the application went to the branch; its manager sees the answers", async ({ page, freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("join-volunteer");
    const name = await branchName(branch);
    const manager = await freshUser({ role: "branch_manager", branch });
    const email = freshAddress("volunteer-choice");
    const sent = await captureSignUp(page, email);
    const auth = await openJoin(page, email, branch);
    await page.getByTestId("signup-choice-volunteer").click();
    await page.getByTestId("signup-volunteer-help").fill(HELP);
    await page.getByTestId("signup-volunteer-time-few_hours_week").check();
    await page.getByTestId("signup-volunteer-commitment").click();
    await auth.submit().click();
    await expect(auth.checkEmailScreen()).toBeVisible();
    expect(sent[0]!.data).toMatchObject({ branch_id: branch, volunteer_application: { help: HELP, time: "few_hours_week", commitment: true } });

    // The captured metadata creates the account the way Auth would (handle_new_user creates the application).
    const created = await adminClient().auth.admin.createUser({ email, password: userPassword(), email_confirm: true, user_metadata: sent[0]!.data });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    try {
      const applicant: TestUser = { id, email, fullName: "E2E Onboarding Signup", branchId: null, role: "follower", status: "active" };
      const own = await pageAs(applicant);
      await own.goto("/dashboard");
      const welcome = own.getByTestId("welcome-screen");
      await expect(welcome).toHaveAttribute("data-variant", "applied", { timeout: APP_LOAD_TIMEOUT });
      await expect(own.getByTestId("welcome-screen-text")).toHaveText(`Your volunteer application has been sent to the ${name} managers. Once approved you'll take part in tasks and meetings. Meanwhile you can attend events.`);
      await own.getByTestId("welcome-continue").click();
      await expect(welcome).toHaveCount(0);
      await expect(own.getByTestId("dashboard-follower-strip-pending")).toBeVisible();

      const reviewer = await pageAs(manager);
      await reviewer.goto("/requests?tab=review");
      const row = reviewer.getByTestId("volunteer-application-review-row").filter({ hasText: "E2E Onboarding Signup" });
      await expect(row).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expect(row.getByTestId("volunteer-application-help")).toHaveText(HELP);
      await expect(row.getByTestId("volunteer-application-time")).toHaveAttribute("data-time", "few_hours_week");
      await expect(row.getByTestId("volunteer-application-commitment")).toBeVisible();
    } finally {
      await adminClient().from("volunteer_applications").delete().eq("user_id", id);
      await deleteAuthUser(id);
    }
  });
});

test.describe("Follower onboarding", () => {
  test("welcome once, then the strip; applying from the strip needs the answers; a decline shows the manager's note; profile explains the role", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("welcome");
    const name = await branchName(branch);
    const manager = await freshUser({ role: "branch_manager", branch });
    const follower = await freshUser({ role: "follower", branch });
    const page = await pageAs(follower);
    await page.goto("/dashboard");
    await expect(page.getByTestId("welcome-screen")).toHaveAttribute("data-variant", "follower", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("welcome-screen-text")).toHaveText(`You're now following ${name}. You'll hear about its events and can attend them. You can apply to become a volunteer any time.`);
    await expect(page.getByTestId("dashboard-follower-strip")).toHaveCount(0);
    await page.getByTestId("welcome-continue").click();
    await expect(page.getByTestId("welcome-screen")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-follower-strip")).toContainText(`You're following ${name}`);
    await page.reload();
    await expect(page.getByTestId("dashboard-follower-strip")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("welcome-screen")).toHaveCount(0);

    await page.goto("/profile");
    await expect(page.getByTestId("profile-role-explanation")).toHaveText(`You follow ${name}: you hear about its events and can attend them.`, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("profile-become-volunteer")).toBeVisible();

    await page.goto("/dashboard");
    await page.getByTestId("dashboard-follower-strip-apply").click({ timeout: APP_LOAD_TIMEOUT });
    const form = page.getByTestId("volunteer-application-form");
    await form.getByTestId("volunteer-application-submit").click();
    for (const field of ["help", "time", "commitment"]) await expect(form.getByTestId(`volunteer-form-${field}-error`)).toBeVisible();
    await form.getByTestId("volunteer-form-help").fill(HELP);
    await form.getByTestId("volunteer-form-time-few_hours_month").check();
    await form.getByTestId("volunteer-form-commitment").click();
    await form.getByTestId("volunteer-application-submit").click();
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    await expect(page.getByTestId("dashboard-follower-strip-pending")).toBeVisible();
    await expect(page.getByTestId("dashboard-follower-strip-apply")).toHaveCount(0);

    const { data: app } = await adminClient().from("volunteer_applications").select("id, motivation, time_commitment").eq("user_id", follower.id).single();
    expect(app).toMatchObject({ motivation: HELP, time_commitment: "few_hours_month" });
    const reason = "We have no open places this term, please apply again later.";
    expect((await rpcAs(manager.email, "decline_volunteer_application", { p_id: (app as { id: string }).id, p_reason: reason })).error).toBeNull();
    await page.reload();
    await expect(page.getByTestId("dashboard-follower-strip-declined")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("dashboard-follower-strip-decline-reason")).toContainText(reason);
    await expect(page.getByTestId("dashboard-follower-strip-apply")).toBeVisible();
  });

  test("volunteers see no welcome screen or strip; the profile explains what volunteering means", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("volunteer-role");
    const name = await branchName(branch);
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-welcome")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("welcome-screen")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-follower-strip")).toHaveCount(0);
    await page.goto("/profile");
    await expect(page.getByTestId("profile-role-explanation")).toHaveText(`You give your time to ${name}: you take on tasks, join meetings and help run events.`, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("profile-become-volunteer")).toHaveCount(0);
  });
});
