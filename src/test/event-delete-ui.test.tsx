import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  remove: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  removeQueries: vi.fn(),
  meeting: null as Record<string, unknown> | null,
  removeMeeting: vi.fn(),
  removeMeetingSeries: vi.fn(),
  linkedTasks: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ id: "event-id" }),
    useSearch: () => ({}),
    useLoaderData: () => null,
  }),
  Link: ({
    children,
    to: _to,
    params: _params,
    ...props
  }: {
    children: ReactNode;
    to?: string;
    params?: unknown;
  }) => <a {...props}>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "meeting" ? mocks.meeting : mocks.data,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidate,
    removeQueries: mocks.removeQueries,
  }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    session: { user: { id: "user-id" } },
    profile: { status: "active" },
    roles: [],
  }),
}));
vi.mock("@/lib/events.functions", () => ({ getEvent: vi.fn(), cancelEvent: vi.fn() }));
vi.mock("@/lib/public-events.functions", () => ({ getPublicEvent: vi.fn() }));
vi.mock("@/lib/delete-event.functions", () => ({
  deleteEvent: mocks.remove,
  deleteSeries: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/events/EventForm", () => ({ EventForm: () => null }));
vi.mock("@/components/events/PastEventDialog", () => ({ PastEventDialog: () => null }));
vi.mock("@/components/events/AttendeeList", () => ({ AttendeeList: () => null }));
vi.mock("@/components/events/AnnounceDialog", () => ({ AnnounceButton: () => null }));
vi.mock("@/components/events/EventVideos", () => ({ EventVideos: () => null }));
vi.mock("@/components/public/PublicEventDetail", () => ({ PublicEventDetail: () => null }));
vi.mock("@/components/tasks/EventLinkedTasks", () => ({
  EventLinkedTasks: (props: unknown) => {
    mocks.linkedTasks(props);
    return null;
  },
}));
vi.mock("@/lib/meetings.functions", () => ({
  getMeeting: vi.fn(),
  setMeetingStatus: vi.fn(),
  deleteMeeting: mocks.removeMeeting,
  deleteMeetingSeries: mocks.removeMeetingSeries,
}));
vi.mock("@/components/meetings/MeetingFormDialog", () => ({ MeetingFormDialog: () => null }));
vi.mock("@/components/events/EventRegistration", () => ({
  RegistrationPanel: () => null,
  ManagerRegistrations: () => null,
}));
vi.mock("@/components/events/EventDialog", () => ({
  EventDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
}));
import "@/lib/i18n";
import { Route } from "@/routes/_app/events_.$id";

const Component = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
  mocks.removeMeeting.mockResolvedValue({ ok: true });
  mocks.removeMeetingSeries.mockResolvedValue({ count: 3 });
  mocks.meeting = null;
  mocks.data = {
    event: {
      id: "event-id",
      title: "Draft",
      organizer: "Dialogue Society",
      category: "community",
      status: "draft",
      start_at: "2099-01-01T18:00:00Z",
      scope: "branch",
      media: [],
    },
    canManage: true,
    deletion: { canManage: true, canDelete: true, pending: false, reason: null },
  };
});
afterEach(cleanup);
describe("event deletion UI permissions and confirmation", () => {
  it("requires confirmation before deleting an eligible manager event, then returns to calendar", async () => {
    render(<Component />);
    fireEvent.click(screen.getByTestId("event-delete-button"));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("event-delete-confirm"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/calendar" }));
    expect(mocks.remove).toHaveBeenCalledWith({ data: { id: "event-id" } });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["event", "event-id"] });
  });
  it("never offers deletion to a volunteer", () => {
    mocks.data["canManage"] = false;
    mocks.data["deletion"] = { canManage: false, canDelete: false, pending: false, reason: null };
    render(<Component />);
    expect(screen.queryByTestId("event-delete-button")).toBeNull();
    expect(screen.queryByTestId("event-delete-confirm")).toBeNull();
  });
  it.each(["published", "cancelled"])("uses simple confirmation for %s events", async (status) => {
    mocks.data["event"] = { ...(mocks.data["event"] as object), status };
    render(<Component />);
    fireEvent.click(screen.getByTestId("event-delete-button"));
    const confirm = screen.getByTestId("event-delete-confirm") as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ data: { id: "event-id" } }));
  });
  it("a past draft can be deleted with simple confirmation", async () => {
    mocks.data["event"] = { ...(mocks.data["event"] as object), start_at: "2020-01-01T00:00:00Z" };
    render(<Component />);
    fireEvent.click(screen.getByTestId("event-delete-button"));
    fireEvent.click(screen.getByTestId("event-delete-confirm"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ data: { id: "event-id" } }));
  });
  it("allows retry but hides edits and cancellation during pending cleanup", () => {
    mocks.data["deletion"] = { canManage: true, canDelete: true, pending: true, reason: null };
    render(<Component />);
    expect(screen.getByTestId("event-delete-button")).toBeDefined();
    expect(screen.queryByTestId("event-edit-button")).toBeNull();
    expect(screen.queryByTestId("event-cancel-event-button")).toBeNull();
  });
});

describe("a meeting's calendar entry", () => {
  const meetingEntry = () => {
    mocks.data = {
      event: {
        id: "event-id",
        title: "Team meeting",
        organizer: "Creator",
        category: "meeting",
        status: "published",
        start_at: "2099-01-01T18:00:00Z",
        end_at: "2099-01-01T19:00:00Z",
        scope: "branch",
        branch_id: "b",
        region_id: "r",
        audience: "members",
        media: [],
      },
      meetingId: "meeting-id",
      canManage: true,
      deletion: { canManage: true, canDelete: true, pending: false, reason: null },
    };
  };
  it("links to the meeting and offers no event management to someone who cannot edit the meeting", () => {
    meetingEntry();
    mocks.meeting = { id: "meeting-id", can_edit: false, status: "scheduled", series_id: null };
    render(<Component />);
    expect(screen.getByTestId("event-open-meeting")).toBeDefined();
    expect(screen.getByTestId("event-detail").getAttribute("data-category")).toBe("meeting");
    expect(screen.queryByTestId("event-detail-gallery")).toBeNull();
    expect(screen.queryByTestId("event-edit-button")).toBeNull();
    expect(screen.queryByTestId("event-delete-button")).toBeNull();
    expect(mocks.linkedTasks).toHaveBeenCalledWith({
      event: {
        id: "event-id",
        title: "Team meeting",
        scope: "branch",
        branch_id: "b",
        region_id: "r",
      },
    });
  });
  it("a meeting editor deletes the meeting, not the event; a series asks which occurrences", async () => {
    meetingEntry();
    mocks.meeting = { id: "meeting-id", can_edit: true, status: "scheduled", series_id: null };
    render(<Component />);
    fireEvent.click(screen.getByTestId("event-delete-button"));
    fireEvent.click(screen.getByTestId("event-delete-confirm"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/calendar" }));
    expect(mocks.removeMeeting).toHaveBeenCalledWith({ data: { id: "meeting-id" } });
    expect(mocks.remove).not.toHaveBeenCalled();
    cleanup();
    mocks.meeting = { id: "meeting-id", can_edit: true, status: "scheduled", series_id: "s" };
    render(<Component />);
    fireEvent.click(screen.getByTestId("event-delete-button"));
    fireEvent.click(screen.getByTestId("recurring-scope-following"));
    await waitFor(() =>
      expect(mocks.removeMeetingSeries).toHaveBeenCalledWith({
        data: { id: "meeting-id", mode: "following" },
      }),
    );
  });
});
