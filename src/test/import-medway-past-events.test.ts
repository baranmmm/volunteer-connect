import { describe as group, expect, it } from "vitest";
import {
  MAX_DESCRIPTION_CHARS,
  PHOTO_FILES,
  checkFolderFiles,
  describe,
  formatLondonDate,
  parseEventsJson,
} from "../../scripts/import-medway-past-events/plan";

const TODAY = "2026-11-27";
const ok = {
  folder: "1-iftar-2026",
  title: "2026 Community Iftar Dinner",
  date: "2026-03-11",
  venue: "Rochester Cathedral (Crypt), Rochester",
};

group("events.json", () => {
  it("reads the events and trims the text", () => {
    const [ev] = parseEventsJson(
      JSON.stringify([{ ...ok, title: "  2026  Community Iftar Dinner " }]),
      TODAY,
    );
    expect(ev).toEqual(ok);
  });

  it("lists every problem at once", () => {
    const bad = [
      { ...ok, folder: "../escape" },
      { ...ok, folder: "b", date: "2026-02-30" },
      { ...ok, folder: "c", date: "2026-11-28" },
      { ...ok, folder: "d", venue: " " },
      { ...ok, folder: "e", title: "" },
      { ...ok },
      { ...ok },
    ];
    const err = (() => {
      try {
        parseEventsJson(JSON.stringify(bad), TODAY);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    })();
    expect(err).toContain("[0]: folder must be a plain folder name");
    expect(err).toContain("[1]: date must be YYYY-MM-DD");
    expect(err).toContain("[2]: date must be in the past");
    expect(err).toContain("[3]: venue must be");
    expect(err).toContain("[4]: title must be");
    expect(err).toContain("[6]: folder 1-iftar-2026 is listed twice");
    expect(err).toContain("[6]: the same title and date are listed twice");
  });

  it("refuses anything that is not a non-empty array", () => {
    expect(() => parseEventsJson("{}", TODAY)).toThrow(/non-empty array/);
    expect(() => parseEventsJson("[", TODAY)).toThrow(/not valid JSON/);
  });
});

group("folder files", () => {
  it("expects exactly 01.jpg–12.jpg and ignores anything else", () => {
    expect(PHOTO_FILES).toHaveLength(12);
    expect(PHOTO_FILES[0]).toBe("01.jpg");
    expect(PHOTO_FILES[11]).toBe("12.jpg");
    expect(checkFolderFiles([...PHOTO_FILES, ".DS_Store", "13.jpg"])).toEqual({
      missing: [],
      ignored: ["13.jpg"],
    });
    expect(checkFolderFiles(PHOTO_FILES.filter((f) => f !== "07.jpg")).missing).toEqual(["07.jpg"]);
  });
});

group("descriptions", () => {
  it("states who, what, where and when in at most two sentences", () => {
    expect(formatLondonDate("2025-12-05")).toBe("5 December 2025");
    expect(describe(ok)).toBe(
      "Dialogue Society Medway held its 2026 Community Iftar Dinner at Rochester Cathedral (Crypt), Rochester, " +
        "on 11 March 2026. Guests from the local community came together to break the fast and share a meal.",
    );
    for (const title of [
      "2026 International Women's Day Iftar",
      "2024 Christmas Dinner",
      "2026 Walk for Peace",
      "Open Day",
    ]) {
      const d = describe({ ...ok, title });
      expect(d.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
      expect(d.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(2);
    }
    expect(describe({ ...ok, title: "Open Day" })).not.toContain("  ");
  });

  it("keeps a description given in events.json", () => {
    expect(describe({ ...ok, description: "Given text." })).toBe("Given text.");
  });
});
