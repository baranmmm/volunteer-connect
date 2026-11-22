import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { HubEvent } from "@/lib/event-rules";

const mocks = vi.hoisted(() => ({ rows: [] as HubEvent[], manager: false }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  Link: ({
    children,
    to: _to,
    params: _params,
    search: _search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: unknown;
    search?: unknown;
  }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.rows, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    session: { user: { id: "me" } },
    profile: { status: "active", full_name: "Test User", branches: null },
    isManager: mocks.manager,
    roles: [mocks.manager ? "branch_manager" : "volunteer"],
  }),
  primaryRole: (roles: string[]) => roles[0],
}));
vi.mock("@/lib/events.functions", () => ({ listEvents: vi.fn() }));
vi.mock("@/components/events/EventForm", () => ({ EventForm: () => null }));
import { setLanguage } from "@/lib/i18n";
import { Route } from "@/routes/_app/dashboard";

const Component = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;
const base: HubEvent = {
  id: "base",
  title: "Event",
  description: "",
  location: "London",
  organizer: "Dialogue Society",
  category: "dialogue",
  start_at: "2026-11-22T18:00:00Z",
  end_at: "2026-11-22T20:00:00Z",
  capacity: null,
  scope: "branch",
  branch_id: "b",
  region_id: "r",
  status: "published",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "",
  created_by: "me",
  deleted_at: null,
  deleted_by: null,
  all_day: false,
  start_date: null,
  end_date: null,
  location_type: "in_person",
  online_url: null,
  media: [],
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
  setLanguage("en");
  mocks.manager = false;
  mocks.rows = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("dashboard event cards", () => {
  it("volunteer: no drafts card, no create button on the empty state", () => {
    render(<Component />);
    expect(screen.getByTestId("dashboard-upcoming-events-empty")).toBeDefined();
    expect(screen.queryByTestId("dashboard-create-event")).toBeNull();
    expect(screen.queryByTestId("dashboard-your-drafts")).toBeNull();
    expect(screen.getByTestId("dashboard-view-all-events")).toBeDefined();
  });
  it("manager: own drafts card and create button; drafts never appear as upcoming", () => {
    mocks.manager = true;
    mocks.rows = [{ ...base, id: "my-draft", status: "draft", title: "My draft" }];
    render(<Component />);
    expect(screen.getByTestId("dashboard-create-event")).toBeDefined();
    const drafts = screen.getByTestId("dashboard-your-drafts");
    expect(
      drafts.querySelector('[data-testid="dashboard-draft-item"][data-event-id="my-draft"]'),
    ).not.toBeNull();
    expect(screen.queryAllByTestId("dashboard-upcoming-event-item")).toHaveLength(0);
  });
  it("labels every upcoming row with its status, including cancelled within 7 days", () => {
    mocks.rows = [
      { ...base, id: "pub" },
      {
        ...base,
        id: "cxl",
        status: "cancelled",
        start_at: "2026-11-23T10:00:00Z",
        end_at: "2026-11-23T11:00:00Z",
      },
    ];
    render(<Component />);
    const rows = screen.getAllByTestId("dashboard-upcoming-event-item");
    expect(rows.map((r) => r.getAttribute("data-event-id"))).toEqual(["pub", "cxl"]);
    expect(
      rows.map((r) =>
        r.querySelector('[data-testid="event-status-badge"]')?.getAttribute("data-status"),
      ),
    ).toEqual(["published", "cancelled"]);
  });
});
