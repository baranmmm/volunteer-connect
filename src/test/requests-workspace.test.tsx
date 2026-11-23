import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { EventRequest } from "@/lib/event-requests";

const mocks = vi.hoisted(() => ({
  role: "branch_manager",
  tab: undefined as "mine" | "review" | "decided" | undefined,
  pending: 2,
  managed: vi.fn(),
  mine: vi.fn(),
  navigate: vi.fn(),
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
    isManager: mocks.role !== "volunteer",
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
    fireEvent.click(screen.getByTestId("my-requests-new"));
    fireEvent.click(screen.getByTestId("request-type-card-task"));
    expect(screen.queryByTestId("test-request-form")).toBeNull();
    fireEvent.click(screen.getByTestId("request-type-card-event"));
    expect(screen.getByTestId("test-request-form")).toBeInTheDocument();
  });
  it("a Branch Manager's mine deep link loads only the personal list", async () => {
    mocks.tab = "mine";
    mount();
    await screen.findByTestId("my-request-row-own");
    expect(mocks.managed).not.toHaveBeenCalled();
  });
  it("Regional Directors cannot submit even through the type chooser", async () => {
    mocks.role = "regional_director";
    mount();
    await screen.findByTestId("manager-request-row-submitted");
    expect(screen.queryByTestId("requests-tab-mine")).toBeNull();
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
