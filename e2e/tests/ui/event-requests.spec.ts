// A3 event requests through the UI. Fresh users (and, for counts, a temporary branch) only; removed after each test.
import { test, expect } from "../../fixtures/roles";
import { REQUEST_TITLE_PREFIX, requestIdByTitle, requestRow, rpcAs, submitRequestAs } from "../../api/eventRequests";
import { DashboardPage } from "../../pages/DashboardPage";
import { RequestsPage } from "../../pages/RequestsPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";
import { EventRequestFormDialog } from "../../pages/components/EventRequestFormDialog";
import { Sidebar } from "../../pages/components/Sidebar";

const title = (label: string) => `${REQUEST_TITLE_PREFIX}ui-${Date.now()} ${label}`;
/** London "YYYY-MM-DD" `days` from today. */
const londonDay = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));
/** The new request's id (from its unique title), once its row is listed in My requests. */
const listedId = async (page: RequestsPage, name: string) => {
  const id = await requestIdByTitle(name);
  await expect(page.myRow(id)).toBeVisible();
  return id;
};

test.describe("Event requests", () => {
  test("a volunteer requests an event from the calendar, sees it in My requests and withdraws it", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    const page = await pageAs(volunteer);
    await page.goto("/calendar?view=list");
    await page.getByTestId("event-request-open-button").click();
    const form = new EventRequestFormDialog(page);
    await form.chooseType("proposal");
    await expect(form.scope()).toHaveAttribute("data-scope", "branch");
    // Required fields are checked before anything is sent.
    await form.submitButton().click();
    await expect(form.fieldError("title")).toBeVisible();
    await expect(form.fieldError("start")).toBeVisible();
    const name = title("volunteer");
    await form.title().fill(name);
    await form.setDateTime("start", `${londonDay(10)}T18:00`);
    await expect(form.endTime()).toContainText("20:00");
    await form.location().fill("E2E Community Hall");
    await form.expectedAttendees().fill("40");
    await form.reason().fill("Neighbourhood dialogue evening");
    await form.submit();
    await expect(page.getByTestId("toast-success")).toBeVisible();
    await expect(page).toHaveURL(/\/my-requests$/);

    const requests = new RequestsPage(page);
    const id = await listedId(requests, name);
    await expect(requests.myStatus(id)).toHaveAttribute("data-status", "submitted");
    expect(await requestRow(id)).toMatchObject({ scope: "branch", branch_id: volunteer.branchId, status: "submitted", requester_id: volunteer.id });
    await requests.myWithdraw(id).click();
    await requests.myConfirm().click();
    await expect(requests.myStatus(id)).toHaveAttribute("data-status", "withdrawn");
    await expect(requests.myWithdraw(id)).toHaveCount(0);
    await expect(requests.myEdit(id)).toHaveCount(0);
    expect((await requestRow(id))?.status).toBe("withdrawn");
  });

  test("a branch manager requests a regional event; the director reviews, approves and lands in the draft's edit form", async ({ freshUser, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const director = await freshUser({ role: "regional_director" });
    const managerPage = await pageAs(manager);
    const asManager = new RequestsPage(managerPage);
    await asManager.gotoMine();
    await asManager.newEventRequest();
    const form = new EventRequestFormDialog(managerPage);
    await form.chooseType("proposal");
    await expect(form.scope()).toHaveAttribute("data-scope", "region");
    const name = title("regional");
    await form.title().fill(name);
    await form.allDay().click();
    await form.startDate().fill(londonDay(14));
    await form.online().click();
    await form.onlineUrl().fill("https://meet.example.org/e2e-regional");
    await form.submit();
    const id = await listedId(asManager, name);
    expect(await requestRow(id)).toMatchObject({ scope: "region", branch_id: null, status: "submitted" });

    // The director never sees a request button; reviews from the Requests page.
    const directorPage = await pageAs(director);
    const asDirector = new RequestsPage(directorPage);
    await asDirector.goto();
    await expect(asDirector.openButton()).toHaveCount(0);
    await asDirector.openManaged(id, "pending");
    await asDirector.startReview().click();
    await expect(asDirector.detailStatus()).toHaveAttribute("data-status", "under_review");
    await asDirector.approve().click();
    await expect(directorPage).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const editor = new EventFormDialog(directorPage);
    await expect(editor.root).toBeVisible();
    await expect(editor.title()).toHaveValue(name);
    const row = await requestRow(id);
    expect(row).toMatchObject({ status: "approved", reviewer_id: director.id });
    expect(directorPage.url()).toContain(row!.event_id!);

    // The requester sees the decision on the dashboard and in My requests.
    const dashboard = new DashboardPage(managerPage);
    await dashboard.goto();
    await expect(dashboard.requestNotice(id)).toHaveAttribute("data-notice", "approved");
    await asManager.gotoMine();
    await expect(asManager.myStatus(id)).toHaveAttribute("data-status", "approved");
  });

  test("decline needs a reason; the requester gets a dashboard notice and can dismiss it", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const id = await submitRequestAs(volunteer.email, title("decline"));
    const requests = new RequestsPage(await pageAs(manager));
    await requests.goto();
    await requests.openManaged(id, "pending");
    await requests.decline().click();
    await requests.declineReason().fill("too short");
    await expect(requests.declineConfirm()).toBeDisabled();
    await requests.declineReason().fill("The hall is already booked that weekend.");
    await requests.declineConfirm().click();
    await expect(requests.page.getByTestId("toast-success")).toBeVisible();
    await expect(requests.detail()).toBeHidden();
    await requests.openManaged(id, "decided");
    await expect(requests.detailStatus()).toHaveAttribute("data-status", "declined");

    const volunteerPage = await pageAs(volunteer);
    const dashboard = new DashboardPage(volunteerPage);
    await dashboard.goto();
    await expect(dashboard.requestNotice(id)).toHaveAttribute("data-notice", "declined");
    await dashboard.dismissRequestNotice(id).click();
    await expect(dashboard.requestNotice(id)).toHaveCount(0);
    const mine = new RequestsPage(volunteerPage);
    await mine.gotoMine();
    await expect(mine.myStatus(id)).toHaveAttribute("data-status", "declined");
    await expect(mine.myDeclineReason(id)).toBeVisible();
    await dashboard.goto();
    await expect(dashboard.requestNotice(id)).toHaveCount(0);
  });

  test("the menu badge and the dashboard count follow the branch's open requests", async ({ freshUser, freshBranch, pageAs, isMobile }) => {
    // A branch of its own, so no other test's requests change these counts.
    const branch = await freshBranch("badge");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ branch });
    const page = await pageAs(manager);
    const dashboard = new DashboardPage(page);
    const sidebar = new Sidebar(page, isMobile);
    await dashboard.goto();
    await expect(dashboard.pendingRequests()).toHaveAttribute("data-count", "0");
    await expect(await sidebar.requestsBadge()).toHaveCount(0);

    const first = await submitRequestAs(volunteer.email, title("badge 1"));
    const second = await submitRequestAs(volunteer.email, title("badge 2"));
    await dashboard.goto();
    await expect(dashboard.pendingRequests()).toHaveAttribute("data-count", "2");
    await expect(await sidebar.requestsBadge()).toHaveAttribute("data-count", "2");

    // Under review still counts as pending; a decision removes it.
    expect((await rpcAs(manager.email, "start_review_event_request", { p_id: first })).error).toBeNull();
    expect((await rpcAs(manager.email, "decline_event_request", { p_id: second, p_reason: "Not this term, sorry." })).error).toBeNull();
    await dashboard.goto();
    await expect(dashboard.pendingRequests()).toHaveAttribute("data-count", "1");
    await expect(await sidebar.requestsBadge()).toHaveAttribute("data-count", "1");
  });
});
