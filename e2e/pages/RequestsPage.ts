import { expect, type Page } from "@playwright/test";

export type ManagerTab = "pending" | "review" | "decided";

/** /requests: "My requests" (requesters) and the reviewers' "Event requests" tabs and detail dialog. */
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
  readonly myDeclineReason = (id: string) => this.page.getByTestId(`my-request-decline-reason-${id}`);
  readonly myConfirm = () => this.page.getByTestId("my-request-confirm");
  /** Rows of my list in order; data-request-id carries each id. */
  readonly myRows = () => this.myList().locator("[data-request-id]");
  // Reviewers
  readonly managerPage = () => this.page.getByTestId("manager-requests-page");
  readonly tab = (tab: ManagerTab) => this.page.getByTestId(`manager-requests-tab-${tab}`);
  readonly managerRow = (id: string) => this.page.getByTestId(`manager-request-row-${id}`);
  readonly detail = () => this.page.getByTestId("manager-request-detail");
  readonly detailStatus = () => this.detail().getByTestId("manager-request-status");
  readonly startReview = () => this.detail().getByTestId("manager-request-start-review");
  readonly approve = () => this.detail().getByTestId("manager-request-approve");
  readonly decline = () => this.detail().getByTestId("manager-request-decline");
  readonly declineReason = () => this.detail().getByTestId("manager-request-decline-reason");
  readonly declineConfirm = () => this.detail().getByTestId("manager-request-decline-confirm");

  async goto() {
    await this.page.goto("/requests");
    // Branch managers see both sections; wait for whichever renders first.
    await expect(this.managerPage().or(this.myList()).first()).toBeVisible();
  }
  /** Opens a reviewer's request from the given tab. */
  async openManaged(id: string, tab: ManagerTab = "pending") {
    await this.tab(tab).click();
    await this.managerRow(id).click();
    await expect(this.detail()).toBeVisible();
  }
}
