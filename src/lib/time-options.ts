/** 00:00, 00:15, ... 23:45 (24-hour). */
export const QUARTER_HOURS = Array.from(
  { length: 96 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);
/** Where the list opens when nothing is chosen yet: the most common event time. */
export const DEFAULT_OPEN_TIME = "18:00";
const TIME = /^\d{2}:\d{2}$/;

/** Time options in sorted order: the quarter hours plus any off-grid times (e.g. 21:51 on an older event). */
export function timeOptions(extra: Iterable<string>): string[] {
  const all = new Set(QUARTER_HOURS);
  for (const time of extra) if (TIME.test(time)) all.add(time);
  return [...all].sort();
}

/**
 * Typeahead target for typed digits (a colon is optional): "19" → 19:00, "193" → 19:30, "1930" / "19:30" → 19:30,
 * "9" → 09:00. Returns the first option starting with the typed prefix, or null.
 */
export function typeaheadTime(typed: string, options: readonly string[]): string | null {
  const digits = typed.replace(/[^0-9]/g, "").slice(0, 4);
  if (!digits) return null;
  const prefix = digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
  const match = (p: string) => options.find((o) => o.startsWith(p)) ?? null;
  return match(prefix) ?? (digits.length === 1 ? match(`0${digits}`) : null);
}
/** The option `delta` steps from `from` (or from the default open time when nothing is chosen), clamped to the list. */
export function stepTime(from: string, delta: number, options: readonly string[]): string {
  const start = options.indexOf(from || DEFAULT_OPEN_TIME);
  const index = Math.min(
    options.length - 1,
    Math.max(0, (start < 0 ? options.indexOf(DEFAULT_OPEN_TIME) : start) + delta),
  );
  return options[index] ?? from;
}
