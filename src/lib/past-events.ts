/** Most photos a past-event record holds (the database enforces the same limit). */
export const MAX_PAST_EVENT_PHOTOS = 12;

/** Today's London calendar date, "YYYY-MM-DD". */
export function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

/** A past event's date: a real date from 1990 up to today (London). */
export function pastEventDateOk(date: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return false;
  return date >= "1990-01-01" && date <= londonToday(now);
}

export type PastEventFields = {
  title: string;
  date: string;
  branchId: string | null;
  photos: number;
};
/** Client checks of the past event form (i18n keys by field). */
export function validatePastEvent(fields: PastEventFields, needsBranch: boolean, now = new Date()) {
  const errors: Record<string, string> = {};
  if (!fields.title.trim()) errors["title"] = "events.fieldRequired";
  else if (fields.title.length > 200) errors["title"] = "events.invalid";
  if (!fields.date) errors["date"] = "events.fieldRequired";
  else if (!pastEventDateOk(fields.date, now)) errors["date"] = "pastEvents.dateError";
  if (needsBranch && !fields.branchId) errors["branch"] = "events.fieldRequired";
  if (fields.photos > MAX_PAST_EVENT_PHOTOS) errors["photos"] = "pastEvents.tooManyPhotos";
  return errors;
}
