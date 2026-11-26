import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";

export type ManagerTab = "pending" | "review" | "decided";

/** /requests: "My requests" and the reviewers' "Waiting for my approval" tab (To review / Decided) and detail dialog. */
export class RequestsPage {
  constructor(readonly page: Page) {}

  readonly openButton = () => this.page.getByTestId("event-request-open-button");
  // My requests
  readonly myList = () => this.page.getByTestId("my-requests-list");
  readonly myRow = (id: string) => this.page.getByTestId(`my-request-row-${id}`);
  readonly myStatus = (id: string) => this.page.getByTestId(`my-request-status-${id}`);
  readonly myEdit = (id: string) => this.page.getByTestId(`my-request-edit-${id}`);
  readonly myWithdraw = (id: string) => this.page.getByTestId(`my-request-withdraw-${id}`);
  readonly myDelete = (id: string) => this.page.getByTestId(`my-request-delete-${id}`);
  readonly myDeclineReason = (id: string) =>
    this.page.getByTestId(`my-request-decline-reason-${id}`);
  readonly myConfirm = () => this.page.getByTestId("my-request-confirm");
  /** Rows of my list in order; data-request-id carries each id. */
  readonly myRows = () => this.myList().locator("[data-request-id]");
  // Reviewers
  readonly managerPage = () => this.page.getByTestId("manager-requests-page");
  /** "Waiting for my approval" (the second of the two tabs) and, inside it, "To review" or "Decided". */
  readonly approvalTab = () => this.page.getByTestId("requests-tab-review");
  readonly tab = (tab: ManagerTab) =>
    this.page.getByTestId(tab === "decided" ? "requests-tab-decided" : "requests-tab-open");
  readonly managerRow = (id: string) => this.page.getByTestId(`manager-request-row-${id}`);
  readonly detail = () => this.page.getByTestId("manager-request-detail");
  readonly detailStatus = () => this.detail().getByTestId("manager-request-status");
  readonly startReview = () => this.detail().getByTestId("manager-request-start-review");
  readonly approve = () => this.detail().getByTestId("manager-request-approve");
  readonly approvePublish = () => this.detail().getByTestId("manager-request-approve-publish");
  readonly editRequest = () => this.detail().getByTestId("manager-request-edit");
  readonly attachments = () => this.detail().getByTestId("manager-request-attachments");
  readonly duplicateWarning = () => this.detail().getByTestId("manager-request-duplicate-warning");
  readonly typeBadge = (id: string) => this.page.getByTestId(`request-type-badge-${id}`).first();
  readonly myEditedNote = (id: string) => this.page.getByTestId(`my-request-edited-${id}`);
  readonly decline = () => this.detail().getByTestId("manager-request-decline");
  readonly declineReason = () => this.detail().getByTestId("manager-request-decline-reason");
  readonly declineConfirm = () => this.detail().getByTestId("manager-request-decline-confirm");

  /** Reviewers' page (/requests). */
  async goto() {
    await this.page.goto("/requests?tab=review");
    await expect(this.managerPage()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }
  /** Requesters' own list in the shared Requests workspace. */
  readonly myPage = () => this.page.getByTestId("my-requests-page");
  readonly newRequest = () => this.page.getByTestId("my-requests-new");
  readonly kindCard = (kind: "event" | "task" | "meeting") =>
    this.page.getByTestId(`request-type-card-${kind}`);
  readonly filter = (filter: "all" | "open" | "decided") =>
    this.page.getByTestId(`my-requests-filter-${filter}`);
  async gotoMine() {
    await this.page.goto("/requests?tab=mine");
    await expect(this.myList()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }
  /** "New request" → the Event card → the event request form (type choice next). */
  async newEventRequest() {
    await this.newRequest().click();
    await this.kindCard("event").click();
  }
  /** Opens a reviewer's request from the given tab. */
  async openManaged(id: string, tab: ManagerTab = "pending") {
    await this.approvalTab().click();
    await this.tab(tab).click();
    await this.managerRow(id).click();
    await expect(this.detail()).toBeVisible();
  }
}
