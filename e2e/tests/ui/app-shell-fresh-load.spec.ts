// Signed-in app shell after a fresh load: "/" hands members over to the dashboard, and the dashboard and the
// navigation render with no console errors or uncaught page errors. Guards the regression where signed-in users got
// a stuck splash on "/" and a blank /dashboard while every signed-out page still rendered.
// Runs on the dev server like every spec, and on a production build with E2E_APP_BUILD=prod (see e2e/README.md).
import type { ConsoleMessage, Page } from "@playwright/test";
import { test, expect, runId } from "../../fixtures/roles";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { createMeetingAs, createTaskAs, inDays, MEETING_TITLE_PREFIX, TASK_TITLE_PREFIX, workRpc } from "../../api/work";

/** The visible navigation: the sidebar on desktop, the bottom bar on phones. */
const nav = (page: Page) => page.getByTestId(/^(app-sidebar|mobile-bottom-nav)$/).filter({ visible: true }).first();

/** Console errors and uncaught exceptions; network noise from optional third parties is not an app error. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource|net::ERR_|basemaps\.cartocdn\.com|tile\.openstreetmap\.org/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

/** A brand-new document on "/" (as after opening the app or a hard refresh), then a reload of /dashboard. */
async function expectShellAfterFreshLoad(page: Page) {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByTestId("dashboard-grid")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(nav(page)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("dashboard-grid")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(nav(page)).toBeVisible();
  expect(errors, errors.join("\n\n")).toEqual([]);
}

test.describe("Signed-in app shell after a fresh load", () => {
  for (const role of ["volunteerMedway", "managerMedway", "director", "followerMedway"] as const) {
    test(`${role}: "/" lands on a rendered dashboard with the navigation`, { tag: "@smoke" }, async ({ pageAs }) => {
      await expectShellAfterFreshLoad(await pageAs(role));
    });
  }

  // Not @smoke: the MFA sign-in can collide with another test's one-time code in the same 30 s window.
  test(`nationalCoordinator: "/" lands on a rendered dashboard with the navigation`, async ({ pageAs }) => {
    await expectShellAfterFreshLoad(await pageAs("nationalCoordinator"));
  });

  test("a branch manager with a real branch's volume: 15 open tasks, meetings with agenda and decisions, own events", async ({
    freshBranch,
    freshUser,
    freshEvent,
    pageAs,
  }) => {
    test.slow();
    const branch = await freshBranch("shell-volume");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const tag = `${runId} shell-${Date.now().toString(36)}`;
    const statuses = ["todo", "in_progress", "blocked"] as const;
    for (let i = 0; i < 15; i++)
      await createTaskAs(manager, {
        scope: "branch",
        branch_id: branch,
        title: `${TASK_TITLE_PREFIX}${tag} task ${i + 1}`,
        status: statuses[i % 3],
        due_date: inDays(i - 3).slice(0, 10),
        assignee_ids: [manager.id, volunteer.id],
      });
    for (let m = 0; m < 4; m++) {
      const meeting = await createMeetingAs(manager, {
        scope: "branch",
        branch_id: branch,
        title: `${MEETING_TITLE_PREFIX}${tag} meeting ${m + 1}`,
        starts_at: inDays(m * 7 - 7),
        ends_at: inDays(m * 7 - 7, 1),
        invitee_ids: [volunteer.id],
      });
      for (let a = 0; a < 3; a++) {
        const item = await workRpc(manager, "add_agenda_item", { p_meeting: meeting, p_title: `Item ${a + 1}` });
        expect(item.error).toBeNull();
        const decision = await workRpc(manager, "add_meeting_decision", { p_item: item.data, p_text: `Decision ${a + 1}` });
        expect(decision.error).toBeNull();
        await createTaskAs(manager, {
          scope: "branch",
          branch_id: branch,
          title: `${TASK_TITLE_PREFIX}${tag} m${m + 1} decision ${a + 1}`,
          decision_id: decision.data as string,
          assignee_ids: [manager.id],
        });
      }
    }
    for (let e = 0; e < 5; e++)
      await freshEvent(manager, {
        label: `shell volume ${e + 1}`,
        status: e === 4 ? "draft" : "published",
        ...(e === 4 ? {} : { startInMinutes: (e + 1) * 1440 }),
        branchId: branch,
      });
    await expectShellAfterFreshLoad(await pageAs(manager));
  });
});
