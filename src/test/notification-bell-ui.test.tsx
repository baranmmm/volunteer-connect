import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Notification } from "@/lib/notifications";

// The header bell: unread badge ("9+" above 9), the accessible label, the popover with the grouped notices, opening
// a notice (marks it read, goes to its link, closes), Escape returning focus to the bell. Followers get no bell.
const mocks = vi.hoisted(() => ({
  member: true,
  total: 12,
  notices: [] as unknown[],
  navigate: vi.fn(),
  markRead: vi.fn(async () => ({ marked: 1 })),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <a {...rest} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/use-work-notices", () => ({
  useWorkMember: () => mocks.member,
  useNotificationCounts: () => ({
    data: { tasks: 0, requests: 0, meetings: 0, total: mocks.total },
  }),
}));
vi.mock("@/lib/use-dashboard-work", () => ({
  DASHBOARD_WORK_KEY: "dashboard-work",
  useDashboardWork: () => ({
    isLoading: false,
    isError: false,
    data: { notifications: mocks.notices },
  }),
}));
vi.mock("@/lib/notifications.functions", () => ({ markNotificationsRead: mocks.markRead }));

import { setLanguage } from "@/lib/i18n";
import { NotificationBell } from "@/components/app/NotificationBell";
import { bellBadge } from "@/lib/use-notification-actions";

const notice = (id: string, read: boolean): Notification => ({
  id,
  kind: "task_assigned",
  entity_type: "task",
  entity_id: "11111111-1111-4111-8111-111111111111",
  title: `Task ${id.slice(0, 2)}`,
  link: "/tasks?task=1",
  payload: {},
  created_at: "2026-11-20T10:00:00Z",
  read_at: read ? "2026-11-20T11:00:00Z" : null,
  actor_name: "Ayse",
  digest_id: null,
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationBell variant="popover" />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await setLanguage("en");
  mocks.member = true;
  mocks.total = 12;
  mocks.notices = [notice("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", false)];
  mocks.navigate.mockReset();
  mocks.markRead.mockClear();
});
afterEach(cleanup);

describe("NotificationBell", () => {
  it("shows 9+ above 9 and labels the button with the unread count", () => {
    expect(bellBadge(3)).toBe("3");
    expect(bellBadge(9)).toBe("9");
    expect(bellBadge(10)).toBe("9+");
    show();
    const bell = screen.getByTestId("header-notifications-bell");
    expect(bell).toHaveAttribute("aria-label", "Notifications, 12 unread");
    expect(screen.getByTestId("header-notifications-badge")).toHaveTextContent("9+");
  });

  it("has no badge at zero and no bell for followers", () => {
    mocks.total = 0;
    show();
    expect(screen.queryByTestId("header-notifications-badge")).toBeNull();
    cleanup();
    mocks.member = false;
    show();
    expect(screen.queryByTestId("header-notifications-bell")).toBeNull();
  });

  it("opens the list; opening a notice marks it read, navigates and closes; Escape returns focus", async () => {
    show();
    const bell = screen.getByTestId("header-notifications-bell");
    fireEvent.click(bell);
    const panel = await screen.findByTestId("notifications-popover");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(screen.getByTestId("notifications-mark-all")).toBeInTheDocument();
    expect(screen.getByTestId("notifications-see-all")).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("notifications-popover")).toBeNull());
    expect(bell).toHaveFocus();

    fireEvent.click(bell);
    fireEvent.click(await screen.findByTestId("dashboard-notification"));
    expect(mocks.markRead).toHaveBeenCalledWith({
      data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    expect(mocks.navigate).toHaveBeenCalledWith({ href: "/tasks?task=1" });
    await waitFor(() => expect(screen.queryByTestId("notifications-popover")).toBeNull());
  });
});
