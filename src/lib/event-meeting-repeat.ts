import { MAX_MEETING_OCCURRENCES } from "@/lib/meetings";

// The meeting repeat of the event form (category "Meeting"): pure helpers shared by the form and its tests.
export type MeetingRepeatState = {
  freq: "none" | "weekly" | "monthly";
  interval: number;
  count: string;
};
export const defaultMeetingRepeat = (): MeetingRepeatState => ({
  freq: "none",
  interval: 1,
  count: "4",
});
/** The recurrence createMeeting expects, or null for a single meeting. */
export function meetingRecurrenceOf(value: MeetingRepeatState) {
  return value.freq === "none"
    ? null
    : { freq: value.freq, interval: value.interval, count: Number(value.count) };
}
/** null when valid; otherwise an i18n key. */
export function meetingRepeatError(value: MeetingRepeatState) {
  if (value.freq === "none") return null;
  const count = Number(value.count);
  return Number.isInteger(count) && count >= 2 && count <= MAX_MEETING_OCCURRENCES
    ? null
    : "events.meetingRepeat.countError";
}
