// Emails in e2e: the e2e app server runs with EMAIL_TRANSPORT=capture, so a sent email is the outbox row with status
// 'sent' and the rendered email in payload.captured (subject, text, html, attachments with the .ics content).
// Reads use the service role (email_outbox has no client access).
import { adminClient } from "./SupabaseClient";
import { e2eCronSecret } from "../setup/email-capture";
import { baseUrl } from "../setup/env";

export type EmailTemplate =
  | "guest_confirm"
  | "registration_confirmed"
  | "event_update"
  | "event_reminder"
  | "registration_cancelled"
  | "event_cancelled"
  | "subscriber_confirm"
  | "event_announcement"
  | "task_reminder"
  | "daily_digest"
  | "notice";

export type CapturedEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { name: string; content: string }[];
  list_unsubscribe: string | null;
};
export type OutboxEmail = {
  id: string;
  template: EmailTemplate;
  status: string;
  registration_id: string | null;
  subscriber_id: string | null;
  event_id: string | null;
  user_id: string | null;
  created_at: string;
  payload: Record<string, unknown>;
  captured: CapturedEmail;
};

export type EmailQuery = {
  template: EmailTemplate;
  /** Recipient address (the captured "to", lowercased). */
  to?: string;
  registrationId?: string;
  subscriberId?: string;
  eventId?: string;
  userId?: string;
  /** Only rows created at or after this time (e.g. to wait for a second email of the same template). */
  since?: string | Date;
  /** Skip these outbox ids (e.g. emails already seen). */
  exclude?: string[];
  timeoutMs?: number;
};

async function findEmails(query: EmailQuery): Promise<OutboxEmail[]> {
  let request = adminClient()
    .from("email_outbox")
    .select("id, template, status, registration_id, subscriber_id, event_id, user_id, created_at, payload")
    .eq("template", query.template)
    .eq("status", "sent")
    .not("payload->captured", "is", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (query.registrationId) request = request.eq("registration_id", query.registrationId);
  if (query.subscriberId) request = request.eq("subscriber_id", query.subscriberId);
  if (query.eventId) request = request.eq("event_id", query.eventId);
  if (query.userId) request = request.eq("user_id", query.userId);
  if (query.since) request = request.gte("created_at", new Date(query.since).toISOString());
  const { data, error } = await request;
  if (error) throw new Error(`read email_outbox: ${error.message}`);
  const to = query.to?.trim().toLowerCase();
  return (data ?? [])
    .map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return { ...row, payload, captured: payload["captured"] as CapturedEmail } as OutboxEmail;
    })
    .filter((row) => !!row.captured && (!to || row.captured.to?.toLowerCase() === to) && !query.exclude?.includes(row.id));
}

/**
 * Waits for a captured email (status 'sent' with payload.captured) and returns the oldest match. Server functions
 * flush transactional emails right after the action; reminders and announcements need `triggerScheduledRun()`.
 */
export async function waitForEmail(query: EmailQuery): Promise<OutboxEmail> {
  const deadline = Date.now() + (query.timeoutMs ?? 15000);
  for (;;) {
    const [email] = await findEmails(query);
    if (email) return email;
    if (Date.now() > deadline) {
      const what = [query.template, query.registrationId, query.subscriberId, query.eventId].filter(Boolean).join(" ");
      throw new Error(`No captured email for ${what} within ${query.timeoutMs ?? 15000} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Every captured email matching the query right now (no waiting). */
export const capturedEmails = (query: Omit<EmailQuery, "timeoutMs">) => findEmails(query);

/**
 * The first absolute URL in the email's text whose path starts with `path` (e.g. "/e/confirm", "/e/cancel",
 * "/updates/confirm", "/updates/unsubscribe", "/events/"). Throws when the email has no such link.
 */
export function linkFrom(email: OutboxEmail | CapturedEmail, path: string): string {
  const captured = "captured" in email ? email.captured : email;
  for (const match of captured.text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = new URL(match[0]);
    if (url.pathname.startsWith(path)) return url.toString();
  }
  throw new Error(`The email has no ${path} link`);
}

/** The same link on this test run's app origin (path and query only), for page.goto. */
export function appPathFrom(email: OutboxEmail | CapturedEmail, path: string): string {
  const url = new URL(linkFrom(email, path));
  return `${url.pathname}${url.search}`;
}

/** The .ics attachment of a captured email, or null. */
export function icsFrom(email: OutboxEmail | CapturedEmail): string | null {
  const captured = "captured" in email ? email.captured : email;
  return captured.attachments?.find((a) => a.name.endsWith(".ics"))?.content ?? null;
}

export type ScheduledRunResult = {
  reminders: number;
  digests: number;
  event_reminders: number;
  emails_sent: number;
  emails_skipped: number;
  emails_failed: number;
};

/** Runs the scheduled job (task reminders, event reminders, then the email sender for every priority). */
export async function triggerScheduledRun(): Promise<ScheduledRunResult> {
  const response = await fetch(`${baseUrl()}/api/public/task-reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e2eCronSecret()}` },
  });
  if (!response.ok) throw new Error(`task-reminders returned ${response.status}`);
  return (await response.json()) as ScheduledRunResult;
}
