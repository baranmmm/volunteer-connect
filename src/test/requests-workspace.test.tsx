import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { EventRequest } from "@/lib/event-requests";
import type { TaskRequest } from "@/lib/work-requests";

const mocks = vi.hoisted(() => ({
  role: "branch_manager",
  tab: undefined as "mine" | "review" | "decided" | undefined,
  pending: 2,
  managed: vi.fn(),
  mine: vi.fn(),
  navigate: vi.fn(),
  targets: [] as { id: string; full_name: string; role: string }[],
  review: vi.fn(),
  myWork: vi.fn(),
  decline: vi.fn(),
  markRead: vi.fn(),
  counts: vi.fn(),
  workCount: 0,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    fullPath: "/_app/requests",
    useSearch: () => ({ tab: mocks.tab }),
  }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    roles: [mocks.role],
    isManager: mocks.role === "branch_manager" || mocks.role === "regional_director",
    profile: { status: "active" },
    session: { user: { id: "member" } },
  }),
}));
vi.mock("@/lib/use-event-requests", () => ({
  useCanRequestEvents: () => mocks.role !== "regional_director",
  usePendingRequestCount: () => ({ data: { total: mocks.pending } }),
}));
vi.mock("@/lib/event-requests.functions", () => ({
  managedEventRequests: mocks.managed,
  myEventRequests: mocks.mine,
  approveEventRequest: vi.fn(),
  eventRequestDuplicates: vi.fn(),
  declineEventRequest: vi.fn(),
  deleteEventRequest: vi.fn(),
  getEventRequest: vi.fn(),
  startReviewEventRequest: vi.fn(),
  withdrawEventRequest: vi.fn(),
}));
vi.mock("@/lib/work-requests.functions", () => ({
  listRequestTargets: async () => mocks.targets,
  listMyWorkRequests: mocks.myWork,
  listWorkRequestsToReview: mocks.review,
  workRequestCount: async () => mocks.workCount,
  submitTaskRequest: vi.fn(),
  submitMeetingRequest: vi.fn(),
  withdrawWorkRequest: vi.fn(),
  declineWorkRequest: mocks.decline,
  acceptTaskRequest: vi.fn(),
  approveMeetingRequest: vi.fn(),
}));
vi.mock("@/lib/notifications.functions", () => ({
  markNotificationsRead: mocks.markRead,
  getNotificationCounts: mocks.counts,
  getReviewWaiting: async () => ({
    work: 0,
    event_requests: 0,
    applications: 0,
    total: 0,
    branches: [],
  }),
}));
vi.mock("@/components/meetings/MeetingFormDialog", () => ({
  MeetingFormDialog: () => <div data-testid="test-meeting-form" />,
}));
vi.mock("@/components/requests/EventRequestForm", () => ({
  EventRequestForm: () => <div data-testid="test-request-form" />,
}));
vi.mock("@/components/requests/RequestParts", () => ({
  RequestAttachments: () => null,
  RequestTypeBadge: () => null,
}));
import { Route } from "@/routes/_app/requests";
import { setLanguage } from "@/lib/i18n";
const Component = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;
const row = (id: string, status: EventRequest["status"]): EventRequest => ({
  id,
  status,
  title: id,
  request_type: "proposal",
  organizer_name: null,
  source: null,
  source_url: null,
  notes: null,
  category: null,
  edited_by_manager: false,
  last_edited_at: null,
  last_edited_by_name: null,
  attachment_count: 0,
  scope: "branch",
  branch_id: "branch",
  region_id: "region",
  branch_name: "Branch",
  region_name: "Region",
  description: null,
  reason: null,
  all_day: false,
  proposed_start: null,
  proposed_end: null,
  proposed_start_date: null,
  proposed_end_date: null,
  alt_start: null,
  alt_end: null,
  alt_start_date: null,
  alt_end_date: null,
  location_text: null,
  is_online: false,
  online_url: null,
  expected_attendees: null,
  decline_reason: null,
  reviewed_at: null,
  created_at: "2026-11-23T09:54:00Z",
  updated_at: "2026-11-23T09:54:00Z",
  reviewer_name: null,
  requester_name: "Member",
  event_id: null,
  notice: null,
  is_own: false,
  can_edit: false,
  can_withdraw: false,
  can_review: false,
  can_delete: false,
});
const taskRequest = (id: string): TaskRequest => ({
  id,
  kind: "task",
  title: `Task ${id}`,
  description: null,
  priority: "high",
  due_date: "2026-12-01",
  status: "submitted",
  task_id: null,
  decline_reason: null,
  scope: "branch",
  branch: "Branch",
  requester_id: "00000000-0000-4000-8000-000000000001",
  requester_name: "Volunteer",
  target_id: "00000000-0000-4000-8000-000000000002",
  target_name: "Coordinator",
  created_at: "2026-11-23T09:54:00Z",
  reviewed_at: null,
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  setLanguage("en");
  mocks.role = "branch_manager";
  mocks.tab = undefined;
  mocks.pending = 2;
  mocks.navigate.mockReset();
  mocks.managed.mockReset();
  mocks.mine.mockReset();
  mocks.managed.mockImplementation(async ({ data }: { data: { tab: string } }) => ({
    rows: [
      row(
        data.tab,
        data.tab === "decided"
          ? "approved"
          : data.tab === "under_review"
            ? "under_review"
            : "submitted",
      ),
    ],
    total: 1,
  }));
  mocks.mine.mockResolvedValue([row("own", "submitted")]);
  mocks.workCount = 0;
  mocks.targets = [
    { id: "00000000-0000-4000-8000-000000000002", full_name: "Manager", role: "branch_manager" },
  ];
  mocks.review.mockReset();
  mocks.review.mockImplementation(async ({ data }: { data: { filter: string } }) =>
    data.filter === "open" ? [taskRequest("work-open")] : [],
  );
  mocks.myWork.mockReset();
  mocks.myWork.mockResolvedValue([]);
  mocks.decline.mockReset();
  mocks.decline.mockResolvedValue({ ok: true });
  mocks.markRead.mockReset();
  mocks.markRead.mockResolvedValue({ marked: 0 });
  mocks.counts.mockReset();
  mocks.counts.mockResolvedValue({ tasks: 0, requests: 1, meetings: 0, total: 1 });
});
afterEach(cleanup);
describe("Requests workspace", () => {
  it("combines submitted and under-review rows using the unchanged manager calls", async () => {
    mount();
    await screen.findByTestId("manager-request-row-submitted");
    await screen.findByTestId("manager-request-row-under_review");
    expect(mocks.managed).toHaveBeenCalledWith({ data: { tab: "submitted", offset: 0 } });
    expect(mocks.managed).toHaveBeenCalledWith({ data: { tab: "under_review", offset: 0 } });
    expect(mocks.mine).not.toHaveBeenCalled();
  });
  it("volunteers only load their own list and can choose Event", async () => {
    mocks.role = "volunteer";
    mount();
    await screen.findByTestId("my-request-row-own");
    expect(mocks.managed).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("my-requests-new"));
    fireEvent.click(screen.getByTestId("request-type-card-event"));
    expect(screen.getByTestId("test-request-form")).toBeInTheDocument();
  });
  it("volunteers can request a task when someone above them can receive it", async () => {
    mocks.role = "volunteer";
    mount();
    fireEvent.click(screen.getByTestId("my-requests-new"));
    await waitFor(() =>
      expect(screen.getByTestId("request-type-card-task")).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
    fireEvent.click(screen.getByTestId("request-type-card-task"));
    expect(await screen.findByTestId("task-request-form")).toBeInTheDocument();
    expect(mocks.markRead).toHaveBeenCalledWith({ data: { entityType: "task_request" } });
    expect(mocks.markRead).toHaveBeenCalledWith({ data: { entityType: "meeting_request" } });
  });
  it("opening Requests sends no mark-read call when no request notice is unread", async () => {
    mocks.role = "volunteer";
    mocks.counts.mockResolvedValue({ tasks: 2, requests: 0, meetings: 1, total: 3 });
    mount();
    await waitFor(() => expect(mocks.counts).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("my-requests-new"));
    expect(await screen.findByTestId("request-type-card-task")).toBeInTheDocument();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
  it("task and meeting cards stay unavailable when nobody can receive the request", async () => {
    mocks.role = "volunteer";
    mocks.targets = [];
    mount();
    fireEvent.click(screen.getByTestId("my-requests-new"));
    await screen.findByTestId("request-type-card-meeting-hint");
    expect(screen.getByTestId("request-type-card-meeting")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(screen.getByTestId("request-type-card-meeting"));
    expect(screen.queryByTestId("meeting-request-form")).toBeNull();
  });
  it("National Coordinators only review task and meeting requests sent to them", async () => {
    mocks.role = "national_coordinator";
    mocks.workCount = 1;
    mount();
    const rowEl = await screen.findByTestId("work-review-row");
    expect(rowEl).toHaveAttribute("data-request-id", "work-open");
    expect(screen.queryByTestId("my-requests-new")).toBeNull();
    expect(screen.queryByTestId("requests-tab-mine")).toBeNull();
    expect(mocks.managed).not.toHaveBeenCalled();
    expect(mocks.mine).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("work-review-decline"));
    const confirm = screen.getByTestId("work-review-decline-confirm");
    fireEvent.change(screen.getByTestId("work-review-decline-note"), {
      target: { value: "too short" },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("work-review-decline-note"), {
      target: { value: "Not this month, sorry" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.decline).toHaveBeenCalledWith({
        data: { id: "work-open", kind: "task", reason: "Not this month, sorry" },
      }),
    );
  });
  it("a Branch Manager's mine deep link loads only the personal list", async () => {
    mocks.tab = "mine";
    mount();
    await screen.findByTestId("my-request-row-own");
    expect(mocks.managed).not.toHaveBeenCalled();
  });
  it("Regional Directors cannot submit events even through the type chooser", async () => {
    mocks.role = "regional_director";
    mount();
    await screen.findByTestId("manager-request-row-submitted");
    // Their "mine" tab holds only task and meeting requests to a National Coordinator.
    expect(screen.getByTestId("requests-tab-mine")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("my-requests-new"));
    fireEvent.click(screen.getByTestId("request-type-card-event"));
    expect(screen.queryByTestId("test-request-form")).toBeNull();
    expect(mocks.mine).not.toHaveBeenCalled();
  });
  it("Decided fetches only the existing decided list", async () => {
    mocks.tab = "decided";
    mount();
    await screen.findByTestId("manager-request-row-decided");
    expect(mocks.managed).toHaveBeenCalledTimes(1);
    expect(mocks.managed).toHaveBeenCalledWith({ data: { tab: "decided", offset: 0 } });
  });
  it("changing tabs navigates to the shared URL with the selected tab", async () => {
    mount();
    fireEvent.mouseDown(screen.getByTestId("requests-tab-mine"), { button: 0, ctrlKey: false });
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/requests",
        search: { tab: "mine" },
        replace: true,
        resetScroll: false,
      }),
    );
  });
});
