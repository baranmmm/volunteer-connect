// Followers in the UI: their menu and dashboard, Donate, followed branches, applying to volunteer (approved by the
// branch's manager), and deleting their own account.
import { test, expect } from "../../fixtures/roles";
import { adminClient, getRoles } from "../../api/SupabaseClient";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { FOLLOWER_MOBILE_PRIMARY, Sidebar } from "../../pages/components/Sidebar";

const DONATE = "https://www.dialoguesociety.org/donation/";

test.describe("Followers", () => {
  test("follower dashboard and menu: no member pages (redirected), Donate opens the donation page in a new tab", { tag: "@smoke" }, async ({ freshUser, pageAs, isMobile }) => {
    const follower = await freshUser({ role: "follower" });
    const page = await pageAs(follower);
    await page.goto("/dashboard");
    await expect(page.getByTestId("follower-dashboard")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("follower-dashboard-donate")).toHaveAttribute("href", DONATE);
    await expect(page.getByTestId("follower-dashboard-donate")).toHaveAttribute("target", "_blank");
    const sidebar = new Sidebar(page, !!isMobile, FOLLOWER_MOBILE_PRIMARY);
    for (const hidden of ["users", "approvals", "tasks", "meetings", "recycle-bin"] as const) expect(await sidebar.hasItem(hidden), hidden).toBe(false);
    expect(await sidebar.hasItem("donate")).toBe(true);
    for (const path of ["/users", "/recycle-bin", "/tasks", "/media"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard$/, { timeout: APP_LOAD_TIMEOUT });
    }
    // The old Approvals address opens Requests, where a follower has only "My requests".
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/requests\?tab=review$/, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("my-requests-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("requests-tab-review")).toHaveCount(0);
  });

  test("applies to volunteer from the dashboard; the branch manager approves in Requests; the follower becomes a volunteer", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("follower-apply");
    const manager = await freshUser({ role: "branch_manager", branch });
    const follower = await freshUser({ role: "follower", branch });
    const page = await pageAs(follower);
    await page.goto("/dashboard");
    // A new follower sees the welcome screen once; the status strip follows.
    await page.getByTestId("welcome-continue").click({ timeout: APP_LOAD_TIMEOUT });
    await page.getByTestId("dashboard-follower-strip-apply").click({ timeout: APP_LOAD_TIMEOUT });
    const form = page.getByTestId("volunteer-application-form");
    await expect(form).toBeVisible();
    await form.getByTestId("volunteer-form-help").fill("I want to help organise dialogue dinners in my area.");
    await form.getByTestId("volunteer-form-time-few_hours_week").check();
    await form.getByTestId("volunteer-form-commitment").click();
    await form.getByTestId("volunteer-application-submit").click();
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    await expect(page.getByTestId("dashboard-follower-strip-pending")).toBeVisible();
    // The Requests "New request" card for volunteer applications is not offered again while one is open.
    await page.goto("/requests");
    await page.getByTestId("my-requests-new").click({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("request-type-card-volunteer")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("request-type-card-event")).toHaveAttribute("aria-disabled", "true");

    const reviewer = await pageAs(manager);
    await reviewer.goto("/requests?tab=review");
    const row = reviewer.getByTestId("volunteer-application-review-row").filter({ hasText: follower.fullName });
    await expect(row).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await row.getByTestId("volunteer-application-approve").click();
    await expect(reviewer.getByTestId("toast-success").last()).toBeVisible();
    await expect.poll(() => getRoles(follower.id)).toEqual(["volunteer"]);
    // Now a volunteer: the approval notice names the branch; the follower strip is gone.
    const { data: branchRow } = await adminClient().from("branches").select("name").eq("id", branch).single();
    await page.goto("/notifications");
    const notice = page.locator('[data-testid="dashboard-notification"][data-kind="volunteer_application_approved"]');
    await expect(notice).toContainText(`You're now a Dialogue Society volunteer at ${(branchRow as { name: string }).name}!`, { timeout: APP_LOAD_TIMEOUT });
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-welcome")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("dashboard-follower-strip")).toHaveCount(0);
  });

  test("followed branches in the profile: add one, remove one, the last one stays", async ({ freshUser, pageAs, seed }) => {
    const follower = await freshUser({ role: "follower" });
    const page = await pageAs(follower);
    await page.goto("/profile");
    const box = page.getByTestId("profile-followed-branches");
    await expect(box.getByTestId("profile-followed-branch")).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(box.getByTestId("profile-unfollow-branch")).toBeDisabled();
    await box.getByTestId("profile-follow-branch-select").selectOption(seed.branches.Brighton);
    await box.getByTestId("profile-follow-branch-button").click();
    await expect(box.getByTestId("profile-followed-branch")).toHaveCount(2);
    await box.locator(`[data-testid="profile-followed-branch"][data-branch-id="${seed.branches.Medway}"]`).getByTestId("profile-unfollow-branch").click();
    await expect(box.getByTestId("profile-followed-branch")).toHaveCount(1);
    const { data } = await adminClient().from("user_followed_branches").select("branch_id").eq("user_id", follower.id);
    expect(data).toEqual([{ branch_id: seed.branches.Brighton }]);
  });

  test("a follower deletes their own account by typing their name; it is soft-deleted and signed out", async ({ freshUser, pageAs }) => {
    const follower = await freshUser({ role: "follower" });
    const page = await pageAs(follower);
    await page.goto("/profile");
    await page.getByTestId("profile-delete-account-button").click({ timeout: APP_LOAD_TIMEOUT });
    const dialog = page.getByTestId("follower-delete-dialog");
    await expect(dialog.getByTestId("follower-delete-confirm")).toBeDisabled();
    await dialog.getByTestId("follower-delete-name-input").fill("Someone Else");
    await expect(dialog.getByTestId("follower-delete-confirm")).toBeDisabled();
    await dialog.getByTestId("follower-delete-name-input").fill(follower.fullName);
    await dialog.getByTestId("follower-delete-confirm").click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: APP_LOAD_TIMEOUT });
    const { data } = await adminClient().from("profiles").select("deleted_at, status").eq("id", follower.id).single();
    expect(data?.deleted_at).not.toBeNull();
    const { data: state } = await adminClient().from("user_deletion_state").select("self_requested").eq("target_id", follower.id).single();
    expect(state).toEqual({ self_requested: true });
  });
});
