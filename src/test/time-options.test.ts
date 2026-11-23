import { describe, expect, it } from "vitest";
import { QUARTER_HOURS, stepTime, timeOptions, typeaheadTime } from "@/lib/time-options";

describe("time picker keyboard helpers", () => {
  it("typeahead: hours, hours and minutes, optional colon, single digits", () => {
    expect(typeaheadTime("19", QUARTER_HOURS)).toBe("19:00");
    expect(typeaheadTime("1930", QUARTER_HOURS)).toBe("19:30");
    expect(typeaheadTime("19:30", QUARTER_HOURS)).toBe("19:30");
    expect(typeaheadTime("193", QUARTER_HOURS)).toBe("19:30");
    expect(typeaheadTime("9", QUARTER_HOURS)).toBe("09:00");
    expect(typeaheadTime("0", QUARTER_HOURS)).toBe("00:00");
    expect(typeaheadTime("1951", timeOptions(["19:51"]))).toBe("19:51");
    expect(typeaheadTime("1951", QUARTER_HOURS)).toBeNull();
    expect(typeaheadTime("", QUARTER_HOURS)).toBeNull();
    expect(typeaheadTime("25", QUARTER_HOURS)).toBeNull();
  });
  it("steps from the chosen time, or from 18:00 when empty, within the list", () => {
    expect(stepTime("19:30", 1, QUARTER_HOURS)).toBe("19:45");
    expect(stepTime("19:30", -1, QUARTER_HOURS)).toBe("19:15");
    expect(stepTime("", 1, QUARTER_HOURS)).toBe("18:15");
    expect(stepTime("23:45", 1, QUARTER_HOURS)).toBe("23:45");
    expect(stepTime("00:00", -1, QUARTER_HOURS)).toBe("00:00");
    expect(stepTime("21:51", 1, timeOptions(["21:51"]))).toBe("22:00");
  });
});
