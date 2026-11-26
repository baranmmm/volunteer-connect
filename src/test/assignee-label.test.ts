import { describe, expect, it } from "vitest";
import { assigneeLabel, shortName } from "@/lib/assignee-label";

// Assignee names on task rows and cards: full name (phones "First L."), "You", "+N", the full list for tooltips.
const opts = { meId: "me", you: "You", formerMember: "Former member" };
const medway = { id: "u1", full_name: "Medway Manager" };
const ayse = { id: "u2", full_name: "Ayşe Nur yılmaz" };

describe("shortName", () => {
  it("first name and the last name's initial; one word as it is; extra spaces ignored", () => {
    expect(shortName("Medway Manager")).toBe("Medway M.");
    expect(shortName("  Ayşe  Nur  Yılmaz ")).toBe("Ayşe Y.");
    expect(shortName("ömer")).toBe("ömer");
    expect(shortName("")).toBe("");
  });
});

describe("assigneeLabel", () => {
  it("nothing without assignees", () => {
    expect(assigneeLabel([], opts)).toBeNull();
  });
  it("one person: full and short name", () => {
    expect(assigneeLabel([medway], opts)).toEqual({
      full: "Medway Manager",
      short: "Medway M.",
      more: 0,
      names: ["Medway Manager"],
      you: false,
    });
  });
  it('the current user is "You", named first, whatever their name', () => {
    const l = assigneeLabel([medway, { id: "me", full_name: "Me Myself" }], opts)!;
    expect(l).toMatchObject({ full: "You", short: "You", more: 1, you: true });
    expect(l.names).toEqual(["You", "Medway Manager"]);
  });
  it("several people: the first name shown and +N; the whole list for the tooltip", () => {
    const l = assigneeLabel([ayse, medway, { id: "u3", full_name: null }], opts)!;
    expect(l).toMatchObject({ full: "Ayşe Nur yılmaz", short: "Ayşe Y.", more: 2, you: false });
    expect(l.names).toEqual(["Ayşe Nur yılmaz", "Medway Manager", "Former member"]);
  });
  it('a person without a name is a former member (not shortened); no signed-in user means no "You"', () => {
    expect(assigneeLabel([{ id: "x", full_name: " " }], opts)).toMatchObject({
      full: "Former member",
      short: "Former member",
    });
    expect(
      assigneeLabel([{ id: "me", full_name: "Me Myself" }], { ...opts, meId: null }),
    ).toMatchObject({
      full: "Me Myself",
      you: false,
    });
  });
});
