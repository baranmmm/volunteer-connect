// The email sender (server only): claims queued email_outbox rows and sends them through Brevo, within the daily limit
// (claim_email_batch: 300 a day, London day; transactional before reminders and the members' daily summary before
// announcements).
// * EMAIL_TRANSPORT=capture (the e2e app server, never production): emails are rendered and stored on the row
//   (payload.captured) instead of being sent.
// * Without BREVO_API_KEY / EMAIL_FROM nothing is claimed: the rows stay pending until the sender is configured.
// * Never throws and never logs addresses or content (only template names and error codes).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  brevoConfig,
  parseSender,
  sendWithBrevo,
  type BrevoConfig,
  type SenderAddress,
} from "./brevo.server";
import {
  appOrigin,
  emailLink,
  isNoticeEmailType,
  noticeUnsubscribeLinks,
} from "./links.server";
import {
  isEmailTemplate,
  renderEmail,
  type EmailEvent,
  type EmailRegistration,
  type RenderContext,
  type RenderedEmail,
} from "./templates";

type Admin = SupabaseClient<Database>;
type ClaimedRow = Database["public"]["Functions"]["claim_email_batch"]["Returns"][number];
export type FlushOptions = { maxPriority?: 1 | 2 | 3; max?: number; origin?: string | null };
export type FlushResult = { sent: number; skipped: number; failed: number };

const TIME_BUDGET_MS = 20000;
const BATCH = 25;
/** Placeholder sender for capture mode when EMAIL_FROM is not set (nothing is sent in capture mode). */
const CAPTURE_FROM: SenderAddress = {
  email: "no-reply@dialoguesociety-hub.invalid",
  name: "Dialogue Society",
};

type Transport =
  | { kind: "capture"; from: SenderAddress }
  | { kind: "brevo"; config: BrevoConfig; from: SenderAddress };

function transport(): Transport | null {
  if (process.env["EMAIL_TRANSPORT"]?.trim() === "capture")
    return { kind: "capture", from: parseSender(process.env["EMAIL_FROM"]) ?? CAPTURE_FROM };
  const config = brevoConfig();
  return config ? { kind: "brevo", config, from: config.from } : null;
}

/** Whether a flush can do anything (capture mode, or Brevo configured). */
export const emailSenderConfigured = () => transport() !== null;

type Prepared = { ok: true; ctx: RenderContext } | { ok: false; skip: string };

const EVENT_FIELDS =
  "id,title,description,location,location_type,location_tba,all_day,start_at,end_at,start_date,end_date,ics_sequence,status,branch_id";

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toEmailEvent(raw: Record<string, unknown>, branch: unknown, region: unknown): EmailEvent {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return {
    id: String(raw["id"]),
    title: str("title") ?? "",
    description: str("description") ?? "",
    location: str("location") ?? "",
    location_type: str("location_type") ?? "in_person",
    location_tba: raw["location_tba"] === true,
    all_day: raw["all_day"] === true,
    start_at: str("start_at"),
    end_at: str("end_at"),
    start_date: str("start_date"),
    end_date: str("end_date"),
    ics_sequence: typeof raw["ics_sequence"] === "number" ? raw["ics_sequence"] : 0,
    status: str("status") ?? "published",
    branch: typeof branch === "string" ? branch : null,
    region: typeof region === "string" ? region : null,
  };
}

async function prepare(
  admin: Admin,
  row: ClaimedRow,
  origin: string,
  from: SenderAddress,
): Promise<Prepared> {
  if (!isEmailTemplate(row.template)) return { ok: false, skip: "unknown_template" };
  const base: RenderContext = {
    origin,
    toEmail: row.to_email,
    toName: row.to_name,
    from,
    payload: asRecord(row.payload),
  };
  if (row.registration_id) {
    const { data, error } = await admin.rpc("email_event_context", {
      p_registration: row.registration_id,
    });
    if (error) throw new Error("context_unavailable");
    const context = asRecord(data);
    const reg = asRecord(context["registration"] as Json);
    const ev = asRecord(context["event"] as Json);
    if (!reg["id"] || !ev["id"]) return { ok: false, skip: "no_context" };
    const registration: EmailRegistration = {
      id: String(reg["id"]),
      status: String(reg["status"] ?? ""),
      places: typeof reg["places"] === "number" ? reg["places"] : 1,
      guest: reg["guest"] === true,
      waitlist_position:
        typeof reg["waitlist_position"] === "number" ? reg["waitlist_position"] : null,
    };
    const links: RenderContext["links"] = {};
    if (registration.guest) {
      if (row.template === "guest_confirm")
        links.guestConfirm = await emailLink("guest-confirm", registration.id, origin);
      links.guestCancel = await emailLink("guest-cancel", registration.id, origin);
    }
    // The online link: only in confirmations and reminders, only for someone who holds a place on a published
    // online event (the claim already skipped unconfirmed guests and inactive members).
    const onlineUrl =
      (row.template === "registration_confirmed" || row.template === "event_reminder") &&
      registration.status === "registered" &&
      ev["location_type"] === "online" &&
      ev["status"] === "published" &&
      !ev["deleted_at"] &&
      typeof ev["online_url"] === "string" &&
      /^https:\/\//.test(ev["online_url"])
        ? (ev["online_url"] as string)
        : null;
    return {
      ok: true,
      ctx: {
        ...base,
        registration,
        onlineUrl,
        // Per-attendee SEQUENCE: the event's counter plus this registration's cancel/re-register offset.
        event: (() => {
          const event = toEmailEvent(ev, context["branch"], context["region"]);
          const offset = typeof reg["ics_offset"] === "number" ? reg["ics_offset"] : 0;
          return { ...event, ics_sequence: event.ics_sequence + offset };
        })(),
        links,
      },
    };
  }
  if (row.subscriber_id) {
    const links: RenderContext["links"] = {};
    if (row.template === "subscriber_confirm") {
      links.subscriberConfirm = await emailLink("subscriber-confirm", row.subscriber_id, origin);
      return { ok: true, ctx: { ...base, links } };
    }
    if (row.template !== "event_announcement" || !row.event_id)
      return { ok: false, skip: "unknown_template" };
    const { data: event, error } = await admin
      .from("events")
      .select(EVENT_FIELDS)
      .eq("id", row.event_id)
      .maybeSingle();
    if (error) throw new Error("context_unavailable");
    if (!event) return { ok: false, skip: "event_closed" };
    let branch: string | null = null;
    if (event.branch_id) {
      const b = await admin.from("branches").select("name").eq("id", event.branch_id).maybeSingle();
      branch = b.data?.name ?? null;
    }
    links.unsubscribe = await emailLink("subscriber-unsubscribe", row.subscriber_id, origin);
    links.unsubscribeOneClick = links.unsubscribe.replace(
      `${origin}/updates/unsubscribe?`,
      `${origin}/api/public/unsubscribe?`,
    );
    return {
      ok: true,
      ctx: {
        ...base,
        event: toEmailEvent(event as unknown as Record<string, unknown>, branch, null),
        links,
      },
    };
  }
  if (row.template === "task_reminder" || row.template === "daily_digest" || row.template === "notice")
    return prepareMemberNotice(admin, row, origin, base);
  return { ok: false, skip: "unknown_template" };
}

/**
 * Member notice emails: the member's language and (for 'notice') the notice at send time (notice_email_context); a
 * notice that was read, removed or whose email was turned off since is skipped. Each email gets its type's signed
 * "stop these emails" link (the daily summary one per type in it).
 */
async function prepareMemberNotice(
  admin: Admin,
  row: ClaimedRow,
  origin: string,
  base: RenderContext,
): Promise<Prepared> {
  if (!row.user_id) return { ok: false, skip: "no_recipient" };
  const { data, error } = await admin.rpc("notice_email_context", { p_id: row.id });
  if (error) throw new Error("context_unavailable");
  const context = asRecord(data);
  if (!data || context["applies"] === false) return { ok: false, skip: "no_longer_applies" };
  const language = context["language"] === "tr" ? "tr" : "en";
  const ctx: RenderContext = { ...base, language };
  const links: NonNullable<RenderContext["links"]> = {};
  if (row.template === "daily_digest") {
    const types = Array.isArray(base.payload?.["types"]) ? (base.payload["types"] as unknown[]) : [];
    const typeLinks: Record<string, string> = {};
    for (const type of types)
      if (typeof type === "string" && isNoticeEmailType(type))
        typeLinks[type] = (await noticeUnsubscribeLinks(row.user_id, type, origin)).page;
    links.typeUnsubscribe = typeLinks;
    return { ok: true, ctx: { ...ctx, links } };
  }
  const type = row.template === "task_reminder" ? "task_reminder" : context["type"];
  if (typeof type !== "string" || !isNoticeEmailType(type)) return { ok: false, skip: "unknown_template" };
  const unsubscribe = await noticeUnsubscribeLinks(row.user_id, type, origin);
  links.noticeUnsubscribe = unsubscribe.page;
  links.noticeUnsubscribeOneClick = unsubscribe.oneClick;
  if (row.template === "task_reminder") return { ok: true, ctx: { ...ctx, links } };
  const n = asRecord(context["notice"] as Json);
  if (!n["kind"]) return { ok: false, skip: "no_longer_applies" };
  return {
    ok: true,
    ctx: {
      ...ctx,
      payload: { ...(base.payload ?? {}), type },
      links,
      notice: {
        kind: String(n["kind"]),
        title: typeof n["title"] === "string" ? n["title"] : "",
        link: typeof n["link"] === "string" ? n["link"] : "/dashboard",
        payload: asRecord(n["payload"] as Json),
        actor_name: typeof n["actor_name"] === "string" ? n["actor_name"] : null,
      },
    },
  };
}

async function finish(
  admin: Admin,
  id: string,
  result: "sent" | "skipped" | "retry",
  error?: string,
) {
  await admin.rpc("finish_email", {
    p_id: id,
    p_result: result,
    ...(error ? { p_error: error } : {}),
  });
}

function captured(rendered: RenderedEmail, to: string) {
  return {
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: rendered.attachments.map((a) => ({ name: a.name, content: a.content })),
    list_unsubscribe: rendered.listUnsubscribe?.oneClick ?? rendered.listUnsubscribe?.url ?? null,
  };
}

/** Claims and sends queued emails (capture mode when EMAIL_TRANSPORT=capture; nothing when BREVO_API_KEY/EMAIL_FROM are
 * missing → rows stay pending). Never throws (logs no personal data). */
export async function flushOutbox(opts: FlushOptions = {}): Promise<FlushResult> {
  const counts: FlushResult = { sent: 0, skipped: 0, failed: 0 };
  try {
    const mode = transport();
    if (!mode) return counts;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Admin;
    const origin = appOrigin(opts.origin);
    const deadline = Date.now() + TIME_BUDGET_MS;
    let remaining = Math.max(1, Math.min(Math.trunc(opts.max ?? 20), 300));
    let stop = false;
    while (!stop && remaining > 0 && Date.now() < deadline) {
      const claim = await admin.rpc("claim_email_batch", {
        p_max: Math.min(remaining, BATCH),
        p_max_priority: opts.maxPriority ?? 3,
      });
      if (claim.error || !claim.data?.length) break;
      remaining -= claim.data.length;
      for (const row of claim.data) {
        // Out of time (or the sender is misconfigured): give the rest back for the next run.
        if (stop || Date.now() > deadline + 10000) {
          await finish(admin, row.id, "retry", stop ? "sender_unavailable" : "deferred");
          continue;
        }
        try {
          if (row.skip_reason || !row.to_email) {
            await finish(admin, row.id, "skipped", row.skip_reason ?? "no_recipient");
            counts.skipped++;
            continue;
          }
          const prepared = await prepare(admin, row, origin, mode.from);
          if (!prepared.ok) {
            await finish(admin, row.id, "skipped", prepared.skip);
            counts.skipped++;
            continue;
          }
          const rendered = renderEmail(
            row.template as Parameters<typeof renderEmail>[0],
            prepared.ctx,
          );
          if (mode.kind === "capture") {
            const { error } = await admin.rpc("capture_email", {
              p_id: row.id,
              p_rendered: captured(rendered, row.to_email) as unknown as Json,
            });
            if (error) throw new Error("capture_failed");
            counts.sent++;
            continue;
          }
          const sent = await sendWithBrevo(mode.config, {
            to: { email: row.to_email, name: row.to_name },
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            attachments: rendered.attachments,
            listUnsubscribe: rendered.listUnsubscribe,
          });
          if (sent.result === "sent") {
            await finish(admin, row.id, "sent");
            counts.sent++;
          } else if (sent.result === "invalid") {
            await finish(admin, row.id, "skipped", sent.error);
            counts.skipped++;
          } else {
            await finish(admin, row.id, "retry", sent.error);
            counts.failed++;
            if (sent.fatal) stop = true;
            console.error(`[email] ${row.template} not sent (${sent.error})`);
          }
        } catch (e) {
          const code =
            e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "render_failed";
          console.error(`[email] ${row.template} failed (${code})`);
          counts.failed++;
          try {
            await finish(admin, row.id, "retry", code);
          } catch {
            /* the claim expires after 15 minutes */
          }
        }
      }
    }
  } catch {
    console.error("[email] outbox flush failed");
  }
  return counts;
}

/** The request's origin inside a server function, for links in emails (APP_URL wins in appOrigin). */
export async function requestOrigin(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    return request?.url ? new URL(request.url).origin : null;
  } catch {
    return null;
  }
}
