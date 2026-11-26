// London wall-clock helpers (a leaf module: event-rules.ts and recurrence.ts both use it, so they do not import
// each other).
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const LONDON = "Europe/London";

export function londonInput(value: string | Date) {
  return formatInTimeZone(value, LONDON, "yyyy-MM-dd'T'HH:mm");
}
export function londonToIso(value: string) {
  const date = fromZonedTime(value, LONDON);
  if (!Number.isFinite(date.getTime()) || londonInput(date) !== value)
    throw new Error("Invalid London time");
  return date.toISOString();
}
