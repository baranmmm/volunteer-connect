// What a push shows (rendered on the server at send time, in the member's language). Lock screens and notification
// centres are seen by others, so a push carries no sensitive detail: a generic title per kind and a generic line (the
// number of requests for the grouped review notice), never the item's title, a person's name, a place or an online
// link. Opening it shows the details in the app. Texts: `push.*` in src/locales/{en,tr}.json.
import enLocale from "@/locales/en.json";
import trLocale from "@/locales/tr.json";

export type PushLanguage = "en" | "tr";
export type PushMessage = {
  title: string;
  body: string;
  /** Path in the app (same origin) the click opens. */
  url: string;
  /** Replaces an earlier notification of the same notice (e.g. the review count going up). */
  tag: string;
  lang: PushLanguage;
};

type Texts = { titles: Record<string, string>; bodies: Record<string, string> };
const TEXTS: Record<PushLanguage, Texts> = {
  en: (enLocale as unknown as { push: Texts }).push,
  tr: (trLocale as unknown as { push: Texts }).push,
};

/** Kinds with their own title; every other kind uses `other`. */
export const PUSH_TITLE_KINDS = [
  "task_assigned",
  "task_group_created",
  "task_note_mention",
  "task_note_added",
  "task_status_changed",
  "task_reminder",
  "review_waiting",
  "meeting_invited",
  "meeting_changed",
  "meeting_cancelled",
  "task_request_accepted",
  "task_request_declined",
  "meeting_request_approved",
  "meeting_request_declined",
  "volunteer_application_approved",
  "volunteer_application_declined",
  "media_upload_approved",
  "media_upload_declined",
  "media_download_approved",
  "media_download_declined",
  "media_photo_nudge",
] as const;

/** A same-origin path, or the notifications page when the stored link is not one. */
export function safeAppPath(link: string | null | undefined): string {
  if (
    typeof link !== "string" ||
    !link.startsWith("/") ||
    link.startsWith("//") ||
    link.includes("\\")
  )
    return "/notifications";
  return link.length > 500 ? "/notifications" : link;
}

export function buildPushMessage(input: {
  kind: string;
  payload?: Record<string, unknown> | null;
  link?: string | null;
  notificationId: string;
  language?: string | null;
}): PushMessage {
  const lang: PushLanguage = input.language === "tr" ? "tr" : "en";
  const texts = TEXTS[lang];
  const known = (PUSH_TITLE_KINDS as readonly string[]).includes(input.kind);
  const title = texts.titles[known ? input.kind : "other"] ?? texts.titles["other"]!;
  let body = texts.bodies["default"]!;
  if (input.kind === "review_waiting") {
    const total = Number(input.payload?.["total"]);
    if (Number.isInteger(total) && total > 0)
      body = (texts.bodies[total === 1 ? "review_one" : "review_other"] ?? body).replace(
        "{{count}}",
        String(total),
      );
  }
  return {
    title,
    body,
    url: safeAppPath(input.link),
    tag: `n-${input.notificationId}`,
    lang,
  };
}
