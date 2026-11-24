import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { agendaCounts, inviteesHeader, inviteesSummary } from "@/components/meetings/meeting-ui";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";

const keys = (o: object, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v as object, `${p}${k}.`) : [`${p}${k}`],
  );
/** A tiny t(): looks the key up in the English translations and fills {{placeholders}}. */
const t = ((key: string, options: Record<string, unknown> = {}) => {
  const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  return String(value ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(options[name]));
}) as unknown as TFunction;

describe("meeting invitees header", () => {
  it("shows the count, the first three names and +N for the rest", () => {
    expect(inviteesSummary(["A", "B", "C", "D", "E"])).toEqual({
      total: 5,
      names: ["A", "B", "C"],
      more: 2,
    });
    const names = ["Ali", "Ayse", "John", "D", "E", "F", "G", "H"];
    expect(inviteesHeader(t, "Invitees", names)).toBe("Invitees (8): Ali, Ayse, John +5");
    expect(inviteesHeader(t, "Invitees", ["Ali", "Ayse"])).toBe("Invitees (2): Ali, Ayse");
    expect(inviteesHeader(t, "Invitees", [])).toBe("Invitees (0)");
  });
});

describe("agenda item counts", () => {
  it("counts decisions and the tasks created from them", () => {
    expect(agendaCounts({ decisions: [] })).toEqual({ decisions: 0, tasks: 0 });
    expect(agendaCounts({ decisions: [{ tasks: [1, 2] }, { tasks: [] }, { tasks: [3] }] })).toEqual(
      {
        decisions: 3,
        tasks: 3,
      },
    );
  });
});

describe("meetings translations", () => {
  it("English and Turkish have the same keys, with plural forms for the counts", () => {
    expect(keys(tr).sort()).toEqual(keys(en).sort());
    for (const k of ["decisionsCount", "tasksCount"])
      expect(keys(en)).toEqual(
        expect.arrayContaining([`meetings.agenda.${k}_one`, `meetings.agenda.${k}_other`]),
      );
    expect(tr.meetings.agenda.expandAll).toBe("Tümünü aç");
  });
});
