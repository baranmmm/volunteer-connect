import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  saved: vi.fn(),
  reorder: vi.fn(),
  invalidate: vi.fn(),
  createMeeting: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "event-branches"
        ? [{ id: "00000000-0000-4000-8000-0000000000b1", name: "Branch" }]
        : [],
    isLoading: false,
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    session: { user: { id: "director" } },
    roles: ["regional_director"],
    profile: { branch_id: null },
  }),
}));
vi.mock("@/lib/events.functions", () => ({
  saveEvent: mocks.save,
  eventBranches: vi.fn(),
  reserveEventMedia: vi.fn(),
  deleteEventMedia: vi.fn(),
  reorderEventMedia: mocks.reorder,
  createSeries: vi.fn(),
  updateSeriesEvent: vi.fn(),
  setEventMediaSize: vi.fn(),
  setEventMediaVariants: vi.fn(),
  setEventMediaGallery: vi.fn(),
}));
vi.mock("@/lib/meetings.functions", () => ({
  createMeeting: mocks.createMeeting,
  listMeetingPeople: vi.fn(),
}));
vi.mock("@/lib/work-scopes", () => ({ listMyWorkScopes: vi.fn() }));
vi.mock("@/lib/event-location.functions", () => ({ saveEventPostcode: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/events/EventDialog", () => ({
  EventDialog: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
import "@/lib/i18n";
import { EventForm } from "@/components/events/EventForm";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue("saved-draft");
  mocks.createMeeting.mockResolvedValue("new-meeting");
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
/** Radix Select keeps a hidden native <select> next to its trigger inside a form; changing it selects the option. */
function pickTime(testId: string, value: string) {
  const native = screen.getByTestId(testId).parentElement?.querySelector("select");
  if (!native) throw new Error(`no native select for ${testId}`);
  fireEvent.change(native, { target: { value } });
}
describe("event form actionable validation", () => {
  it("empty Save draft and Publish remain enabled, validate on click and focus the title", async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    for (const id of ["event-form-save-draft", "event-form-publish"]) {
      const button = screen.getByTestId(id) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId("event-form-title")),
      );
      expect(screen.getByTestId("event-form-title").getAttribute("aria-invalid")).toBe("true");
      expect(mocks.save).not.toHaveBeenCalled();
    }
  });
  it("a title-only draft saves with no fabricated date, then calls onSaved", async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "Only a title" } });
    fireEvent.click(screen.getByTestId("event-form-save-draft"));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledWith("saved-draft"));
    expect(mocks.save).toHaveBeenCalledWith({
      data: {
        id: null,
        event: expect.objectContaining({
          title: "Only a title",
          start_at: null,
          end_at: null,
          status: "draft",
          scope: "region",
          branch_id: null,
        }),
      },
    });
  });
  it("Publish reports missing location/start/end instead of silently disabling", async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "Publish me" } });
    fireEvent.click(screen.getByTestId("event-form-publish"));
    await waitFor(() =>
      expect(screen.getByTestId("event-form-start-date").getAttribute("aria-invalid")).toBe("true"),
    );
    for (const id of ["event-form-start-time", "event-form-end-date", "event-form-end-time"])
      expect(screen.getByTestId(id).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("event-form-location").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
describe("A2a form controls", () => {
  it("All day hides time inputs and shows date pickers; End follows Start + 2 hours", () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId("event-form-start-date"), {
      target: { value: "2027-01-10" },
    });
    pickTime("event-form-start-time", "18:00");
    expect((screen.getByTestId("event-form-end-date") as HTMLInputElement).value).toBe(
      "2027-01-10",
    );
    expect(screen.getByTestId("event-form-end-time").textContent).toBe("20:00");
    // Late start: End moves to the next day.
    pickTime("event-form-start-time", "23:15");
    expect((screen.getByTestId("event-form-end-date") as HTMLInputElement).value).toBe(
      "2027-01-11",
    );
    expect(screen.getByTestId("event-form-end-time").textContent).toBe("01:15");
    fireEvent.click(screen.getByTestId("event-form-all-day"));
    expect(screen.queryByTestId("event-form-start-time")).toBeNull();
    expect(screen.queryByTestId("event-form-end-time")).toBeNull();
    expect((screen.getByTestId("event-form-start-date") as HTMLInputElement).type).toBe("date");
    expect((screen.getByTestId("event-form-end-date") as HTMLInputElement).type).toBe("date");
  });
  it("offers a location type and accepts Word and PowerPoint files", () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    expect(screen.getByTestId("event-form-location-type")).toBeTruthy();
    const accept = (screen.getByTestId("event-form-file-input") as HTMLInputElement).accept;
    expect(accept).toContain(".docx");
    expect(accept).toContain(".pptx");
  });
});
describe("quarter-hour time picker", () => {
  it("lists 00:00..23:45 in 15-minute steps and keeps an off-grid time of an existing event", async () => {
    const { QUARTER_HOURS, timeOptions } = await import("@/lib/time-options");
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(QUARTER_HOURS.slice(0, 3)).toEqual(["00:00", "00:15", "00:30"]);
    expect(QUARTER_HOURS.at(-1)).toBe("23:45");
    const withOdd = timeOptions(["21:51"]);
    expect(withOdd).toHaveLength(97);
    expect(withOdd.slice(withOdd.indexOf("21:45"), withOdd.indexOf("21:45") + 3)).toEqual([
      "21:45",
      "21:51",
      "22:00",
    ]);
    const event = {
      id: "e1",
      title: "Old",
      description: "",
      location: "Hall",
      location_type: "in_person",
      online_url: null,
      organizer: "Dialogue Society",
      category: "dialogue",
      status: "published",
      all_day: false,
      start_date: null,
      end_date: null,
      start_at: "2027-01-10T21:51:00Z",
      end_at: "2027-01-10T23:07:00Z",
      capacity: null,
      scope: "branch",
      branch_id: "b1",
      media: [],
    };
    render(<EventForm event={event as never} onClose={vi.fn()} onSaved={mocks.saved} />);
    expect(screen.getByTestId("event-form-start-time").textContent).toBe("21:51");
    expect(screen.getByTestId("event-form-end-time").textContent).toBe("23:07");
    // Changing to a quarter hour and back: the original 21:51 is still an option.
    pickTime("event-form-start-time", "22:00");
    expect(screen.getByTestId("event-form-start-time").textContent).toBe("22:00");
    pickTime("event-form-start-time", "21:51");
    expect(screen.getByTestId("event-form-start-time").textContent).toBe("21:51");
  });
});

/** Radix Select keeps a hidden native <select>: changing it picks the option. */
function pick(testId: string, value: string) {
  const native = screen.getByTestId(testId).parentElement?.querySelector("select");
  if (!native) throw new Error(`no native select for ${testId}`);
  fireEvent.change(native, { target: { value } });
}
const section = (name: string) => screen.getByTestId(`event-form-section-${name}`);
const toggleOf = (name: string) => screen.getByTestId(`event-form-section-${name}-toggle`);
describe("simpler event form", () => {
  it("shows title, category, date/time and place; every other section starts collapsed", () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    for (const id of [
      "event-form-title",
      "event-form-category",
      "event-form-start-date",
      "event-form-location-type",
      "event-form-location",
    ])
      expect(screen.getByTestId(id)).toBeTruthy();
    for (const name of ["description", "registration", "audience", "files", "repeat"]) {
      expect(toggleOf(name).getAttribute("aria-expanded")).toBe("false");
      expect(section(name).getAttribute("data-open")).toBe("false");
    }
    expect(screen.getByTestId("event-form-capacity").closest("[hidden]")).not.toBeNull();
    fireEvent.click(toggleOf("registration"));
    expect(toggleOf("registration").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("event-form-capacity").closest("[hidden]")).toBeNull();
  });
  it("online: the link field sits with the place, outside every section", () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    pick("event-form-location-type", "online");
    const url = screen.getByTestId("event-form-online-url");
    expect(url.closest('[data-testid^="event-form-section-"]')).toBeNull();
  });
  it("an invalid value in a collapsed section opens it on save", async () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "Draft" } });
    fireEvent.click(toggleOf("registration"));
    fireEvent.change(screen.getByTestId("event-form-capacity"), { target: { value: "0" } });
    fireEvent.click(toggleOf("registration"));
    expect(section("registration").getAttribute("data-open")).toBe("false");
    fireEvent.click(screen.getByTestId("event-form-save-draft"));
    await waitFor(() => expect(section("registration").getAttribute("data-open")).toBe("true"));
    expect(screen.getByTestId("event-form-capacity").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("editing an event never offers the Meeting category", () => {
    const event = {
      id: "e1",
      title: "Old",
      description: "",
      location: "Hall",
      location_type: "in_person",
      online_url: null,
      organizer: "Dialogue Society",
      category: "dialogue",
      status: "published",
      all_day: false,
      start_date: null,
      end_date: null,
      start_at: "2027-01-10T18:00:00Z",
      end_at: "2027-01-10T20:00:00Z",
      capacity: null,
      scope: "branch",
      branch_id: "b1",
      media: [],
    };
    render(<EventForm event={event as never} onClose={vi.fn()} onSaved={mocks.saved} />);
    const native = screen.getByTestId("event-form-category").parentElement?.querySelector("select");
    expect([...(native?.options ?? [])].map((o) => o.value)).not.toContain("meeting");
  });
});
describe("Meeting category", () => {
  it("turns the form into a meeting form: invitees and meeting repeat, no registration, audience, files or draft", () => {
    render(<EventForm onClose={vi.fn()} onSaved={mocks.saved} />);
    pick("event-form-category", "meeting");
    expect(screen.getByTestId("event-form").getAttribute("data-mode")).toBe("meeting");
    expect(screen.getByTestId("event-form-invitees")).toBeTruthy();
    expect(screen.getByTestId("event-form-meeting-repeat-freq")).toBeTruthy();
    expect(screen.queryByTestId("event-form-repeat")).toBeNull();
    for (const name of ["registration", "audience", "files"])
      expect(screen.queryByTestId(`event-form-section-${name}`)).toBeNull();
    expect(screen.queryByTestId("event-form-all-day")).toBeNull();
    expect(screen.queryByTestId("event-form-save-draft")).toBeNull();
  });
  it("saves through createMeeting with the form values and opens the meeting page", async () => {
    const onClose = vi.fn();
    render(<EventForm onClose={onClose} onSaved={mocks.saved} />);
    pick("event-form-category", "meeting");
    pick("event-form-scope", "region");
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "Team meeting" } });
    fireEvent.change(screen.getByTestId("event-form-start-date"), {
      target: { value: "2027-01-10" },
    });
    pickTime("event-form-start-time", "18:00");
    fireEvent.change(screen.getByTestId("event-form-location"), { target: { value: "Office" } });
    pick("event-form-meeting-repeat-freq", "weekly");
    pick("event-form-meeting-repeat-interval", "2");
    fireEvent.change(screen.getByTestId("event-form-meeting-repeat-count"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByTestId("event-form-publish"));
    // The region of a director comes from the work scopes (none in this mock): the scope is reported, nothing is saved.
    await waitFor(() =>
      expect(screen.getByTestId("event-form-section-repeat").getAttribute("data-open")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("event-form-meeting-repeat-count").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(mocks.createMeeting).not.toHaveBeenCalled();
    pick("event-form-scope", "branch");
    pick("event-form-branch", "00000000-0000-4000-8000-0000000000b1");
    fireEvent.change(screen.getByTestId("event-form-meeting-repeat-count"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByTestId("event-form-publish"));
    await waitFor(() => expect(mocks.createMeeting).toHaveBeenCalled());
    expect(mocks.createMeeting).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: "branch",
        branch_id: "00000000-0000-4000-8000-0000000000b1",
        region_id: null,
        title: "Team meeting",
        starts_at: "2027-01-10T18:00:00.000Z",
        ends_at: "2027-01-10T20:00:00.000Z",
        location_type: "in_person",
        location: "Office",
        online_url: null,
        invitee_ids: [],
        recurrence: { freq: "weekly", interval: 2, count: 6 },
      }),
    });
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/meetings/$id",
        params: { id: "new-meeting" },
      }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
