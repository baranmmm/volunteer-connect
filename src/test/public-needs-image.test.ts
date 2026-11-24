import { describe, expect, it } from "vitest";
import { publicNeedsImage, validateEventForm } from "@/lib/event-form-rules";

const now = new Date("2026-11-24T12:00:00Z");
const base = {
  title: "Open day",
  start: "2026-12-01T18:00",
  end: "2026-12-01T20:00",
  location: "Hall",
  category: "dialogue",
  scope: "branch",
  branch: "b1",
  capacity: "",
  organizer: "Dialogue Society",
};

describe("a public event needs a cover image to be published", () => {
  it("publicNeedsImage: only published public events without an image", () => {
    expect(publicNeedsImage({ audience: "public", hasImage: false }, "published")).toBe(true);
    expect(publicNeedsImage({ audience: "public", hasImage: true }, "published")).toBe(false);
    expect(publicNeedsImage({ audience: "public", hasImage: false }, "draft")).toBe(false);
    expect(publicNeedsImage({ audience: "members", hasImage: false }, "published")).toBe(false);
  });
  it("the form shows the error on the files field", () => {
    expect(
      validateEventForm({ ...base, audience: "public", hasImage: false }, "published", { now }),
    ).toEqual({
      files: "events.coverRequired",
    });
    expect(
      validateEventForm({ ...base, audience: "public", hasImage: true }, "published", { now }),
    ).toEqual({});
    expect(
      validateEventForm({ ...base, audience: "public", hasImage: false }, "draft", { now }),
    ).toEqual({});
  });
  it("location 'To be announced' publishes without a place; date and time stay required", () => {
    expect(
      validateEventForm({ ...base, location: "", locationTba: true }, "published", { now }),
    ).toEqual({});
    expect(validateEventForm({ ...base, location: "" }, "published", { now })).toEqual({
      location: "events.fieldRequired",
    });
    expect(
      validateEventForm(
        { ...base, location: "", locationTba: true, start: "", end: "" },
        "published",
        { now },
      ),
    ).toEqual({ start: "events.fieldRequired", end: "events.fieldRequired" });
  });
  it("places per registration: 1 to 10", () => {
    for (const ok of ["1", "4", "10"])
      expect(validateEventForm({ ...base, maxPlaces: ok }, "published", { now })).toEqual({});
    for (const bad of ["0", "11", "1.5", "", "-2"])
      expect(validateEventForm({ ...base, maxPlaces: bad }, "published", { now })).toEqual({
        "max-places": "events.maxPlacesError",
      });
  });
});
