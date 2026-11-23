// Unified /requests workspace: role-specific lists and request kinds.
import { test, expect } from "../../fixtures/roles";
import { REQUEST_TITLE_PREFIX, rpcAs, submitRequestAs } from "../../api/eventRequests";
import { RequestsPage } from "../../pages/RequestsPage";
import { EventRequestFormDialog } from "../../pages/components/EventRequestFormDialog";
import { Sidebar } from "../../pages/components/Sidebar";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

test.describe("My Requests", () => {
  for (const role of ["volunteer", "branch_manager", "regional_director"] as const) {
    test(`one Requests menu item is shown to a ${role}`, async ({
      freshUser,
      pageAs,
      isMobile,
    }) => {
      const page = await pageAs(await freshUser({ role }));
      await page.goto("/dashboard");
      const sidebar = new Sidebar(page, isMobile);
      expect(await sidebar.hasItem("my-requests")).toBe(false);
      expect(await sidebar.hasItem("requests")).toBe(true);
      await sidebar.go("requests");
      await expect(page.getByTestId("my-requests-page")).toBeVisible();
      await expect(page.getByTestId("requests-tab-mine")).toHaveCount(
        role === "branch_manager" ? 1 : 0,
      );
    });
  }

  test("Task and Meeting are not available yet; Event opens the event request form", async ({
    freshUser,
    pageAs,
  }) => {
    const page = await pageAs(await freshUser());
    const mine = new RequestsPage(page);
    await mine.gotoMine();
    await mine.newRequest().click();
    for (const kind of ["task", "meeting"] as const) {
      await expect(mine.kindCard(kind)).toHaveAttribute("aria-disabled", "true");
      await mine.kindCard(kind).click({ force: true });
      await expect(mine.kindCard(kind)).toBeVisible(); // nothing opened
    }
    await expect(page.getByTestId("event-request-type-choice")).toHaveCount(0);
    await expect(mine.kindCard("event")).toHaveAttribute("aria-disabled", "false");
    await mine.kindCard("event").click();
    await expect(page.getByTestId("event-request-type-choice")).toBeVisible();
    await new EventRequestFormDialog(page).chooseType("external");
  });

  test("filters: All, Open and Decided", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    const open = await submitRequestAs(
      volunteer.email,
      `${REQUEST_TITLE_PREFIX}${Date.now()} open`,
    );
    const decided = await submitRequestAs(
      volunteer.email,
      `${REQUEST_TITLE_PREFIX}${Date.now()} withdrawn`,
    );
    expect(
      (await rpcAs(volunteer.email, "withdraw_event_request", { p_id: decided })).error,
    ).toBeNull();
    const mine = new RequestsPage(await pageAs(volunteer));
    await mine.gotoMine();
    await expect(mine.myRow(open)).toBeVisible();
    await expect(mine.myRow(decided)).toBeVisible();
    await expect(mine.typeBadge(open)).toHaveAttribute("data-type", "proposal");
    await mine.filter("open").click();
    await expect(mine.myRow(open)).toBeVisible();
    await expect(mine.myRow(decided)).toHaveCount(0);
    await mine.filter("decided").click();
    await expect(mine.myRow(decided)).toBeVisible();
    await expect(mine.myRow(open)).toHaveCount(0);
    await mine.filter("all").click();
    await expect(mine.myRows()).toHaveCount(2);
  });

  test("volunteers see their list without manager tabs", async ({ freshUser, pageAs }) => {
    const page = await pageAs(await freshUser());
    await page.goto("/requests");
    // Wait for the page first: before it loads, the absence checks below would pass for any role.
    await expect(page.getByTestId("my-requests-list")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("manager-requests-page")).toHaveCount(0);
    await expect(page.getByTestId("requests-tab-review")).toHaveCount(0);
    await page.goto("/my-requests");
    await expect(page).toHaveURL(/\/requests\?tab=mine$/);
  });
});
