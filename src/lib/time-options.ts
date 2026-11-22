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
