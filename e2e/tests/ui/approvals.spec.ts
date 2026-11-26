import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { ApprovalsPage } from "../../pages/ApprovalsPage";
import { adminClient, getProfile } from "../../api/SupabaseClient";
import { Sidebar } from "../../pages/components/Sidebar";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

// Pending sign-ups are approved in Requests → "Waiting for my approval" (the old /approvals address redirects there).
test.describe("Approvals", () => {
  test.use({ storageState: storageFor("managerMedway") });

  test("a branch manager approves a pending volunteer", async ({ page, freshUser }) => {
    const user = await freshUser({ status: "pending" });
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await expect(approvals.row(user.id)).toBeVisible();
    await approvals.approve(user.id);
    await expect(toastSuccess(page)).toBeVisible();
    await expect(approvals.row(user.id)).toHaveCount(0);
    await expect.poll(async () => (await getProfile(user.id))?.status).toBe("active");
  });

  test("a branch manager rejects a pending volunteer", async ({ page, freshUser }) => {
    const user = await freshUser({ status: "pending" });
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await approvals.reject(user.id);
    await expect(toastSuccess(page)).toBeVisible();
    await expect(approvals.row(user.id)).toHaveCount(0);
    await expect.poll(async () => (await getProfile(user.id))?.status).toBe("inactive");
  });

  test("only pending volunteers from the manager's own branch are listed", async ({ page, seed, freshUser }) => {
    const brightonPending = await freshUser({ status: "pending", branch: "Brighton" });
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await expect(approvals.row(seed.users.pendingMedway.id)).toBeVisible();
    await expect(approvals.row(seed.users.pendingBrighton.id)).toHaveCount(0);
    await expect(approvals.row(brightonPending.id)).toHaveCount(0);
  });
});

test.describe("Approvals access", () => {
  test.use({ storageState: storageFor("volunteerMedway") });

  test("volunteers following an old Approvals link see only their own requests", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/requests\?tab=review$/, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("my-requests-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("requests-tab-review")).toHaveCount(0);
    await expect(page.getByTestId("approvals-row")).toHaveCount(0);
  });
});

// One number for "Waiting for my approval": the shared review count (here a volunteer application) plus pending sign-ups
// and account deletion requests, on the tab and on the menu's Requests badge alike. A branch of its own keeps the
// counts free of other tests' rows.
test.describe("Waiting for my approval badge", () => {
  test("the tab and the menu count a volunteer application, a pending sign-up and a deletion request; approving one lowers both", async ({ freshBranch, freshUser, pageAs, isMobile }) => {
    const branch = await freshBranch("approval-badge");
    const manager = await freshUser({ role: "branch_manager", branch });
    const pending = await freshUser({ status: "pending", branch });
    const leaving = await freshUser({ branch });
    const applicant = await freshUser({ role: "follower", branch });
    const db = adminClient();
    const application = await db
      .from("volunteer_applications")
      .insert({ user_id: applicant.id, branch_id: branch, motivation: "I would like to help at events." })
      .select("id")
      .single();
    expect(application.error).toBeNull();
    const deletion = await db.from("account_deletion_requests").insert({ user_id: leaving.id }).select("id").single();
    expect(deletion.error).toBeNull();
    try {
      const page = await pageAs(manager);
      const approvals = new ApprovalsPage(page);
      const sidebar = new Sidebar(page, isMobile);
      const tabBadge = page.getByTestId("manager-requests-tab-review");
      const expectBoth = async (count: number) => {
        await expect(tabBadge).toHaveText(String(count), { timeout: APP_LOAD_TIMEOUT });
        await expect(await sidebar.requestsBadge()).toHaveAttribute("data-count", String(count), { timeout: APP_LOAD_TIMEOUT });
        if (isMobile) {
          await page.keyboard.press("Escape");
          await expect(page.getByTestId("mobile-nav-more-sheet")).toBeHidden();
        }
      };
      await page.goto("/requests?tab=review");
      await expect(approvals.row(pending.id)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expect(approvals.deletionRowForUser(leaving.id)).toBeVisible();
      await expectBoth(3);

      await approvals.approve(pending.id);
      await expect(toastSuccess(page)).toBeVisible();
      await expect(approvals.row(pending.id)).toHaveCount(0);
      await expectBoth(2);
    } finally {
      await db.from("account_deletion_requests").update({ status: "cancelled", handled_at: new Date().toISOString() }).eq("id", deletion.data!.id);
      await db.from("volunteer_applications").delete().eq("id", application.data!.id);
    }
  });
});
