// Brevo transactional email API (server only). Free plan: 300 emails a day, which the outbox enforces.
// Configuration: BREVO_API_KEY and EMAIL_FROM ("Name <address>" or a bare address). Nothing here logs addresses or
// content; errors carry only HTTP status codes.

export type SenderAddress = { email: string; name: string | null };
export type BrevoConfig = { apiKey: string; from: SenderAddress };

const ADDRESS = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

/** "Dialogue Society <events@example.org>" or "events@example.org"; null when invalid. */
export function parseSender(value: string | null | undefined): SenderAddress | null {
  const raw = value?.trim();
  if (!raw) return null;
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(raw);
  const email = (named?.[2] ?? raw).trim();
  if (!ADDRESS.test(email)) return null;
  const name =
    named?.[1]
      ?.trim()
      .replace(/^"(.*)"$/, "$1")
      .trim() || null;
  return { email, name };
}

/** The sender configuration, or null when BREVO_API_KEY or EMAIL_FROM is missing (emails then stay queued). */
export function brevoConfig(): BrevoConfig | null {
  const apiKey = process.env["BREVO_API_KEY"]?.trim();
  const from = parseSender(process.env["EMAIL_FROM"]);
  return apiKey && from ? { apiKey, from } : null;
}

export type BrevoMessage = {
  to: { email: string; name?: string | null | undefined };
  subject: string;
  html: string;
  text: string;
  attachments?: { name: string; content: string }[] | undefined;
  /** Announcements: List-Unsubscribe (and one-click List-Unsubscribe-Post when a POST endpoint is given). */
  listUnsubscribe?: { url: string; oneClick?: string | undefined } | null | undefined;
};

/** sent; retry (rate limit, server or network error, configuration); invalid (the recipient is rejected for good). */
export type BrevoResult =
  { result: "sent" } | { result: "retry" | "invalid"; error: string; fatal?: boolean };

/** UTF-8 text as base64 (Workers runtime: no Buffer). */
export function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function sendWithBrevo(
  config: BrevoConfig,
  message: BrevoMessage,
  timeoutMs = 10000,
): Promise<BrevoResult> {
  const body: Record<string, unknown> = {
    sender: config.from.name
      ? { email: config.from.email, name: config.from.name }
      : { email: config.from.email },
    to: [
      message.to.name
        ? { email: message.to.email, name: message.to.name.slice(0, 120) }
        : { email: message.to.email },
    ],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
  };
  if (message.attachments?.length)
    body["attachment"] = message.attachments.map((a) => ({
      name: a.name,
      content: toBase64(a.content),
    }));
  if (message.listUnsubscribe) {
    const target = message.listUnsubscribe.oneClick ?? message.listUnsubscribe.url;
    body["headers"] = message.listUnsubscribe.oneClick
      ? { "List-Unsubscribe": `<${target}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : { "List-Unsubscribe": `<${target}>` };
  }
  let response: Response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { result: "retry", error: "network" };
  }
  if (response.ok) return { result: "sent" };
  const status = response.status;
  if (status === 429 || status >= 500) return { result: "retry", error: `http_${status}` };
  // Configuration problems (key, sender, account): retry later and stop this run.
  if (status === 401 || status === 402 || status === 403)
    return { result: "retry", error: `http_${status}`, fatal: true };
  if (status === 400) {
    let code = "",
      text = "";
    try {
      const json = (await response.json()) as { code?: unknown; message?: unknown };
      code = typeof json.code === "string" ? json.code : "";
      text = typeof json.message === "string" ? json.message : "";
    } catch {
      /* no body */
    }
    // Brevo answers an unusable recipient with invalid_parameter mentioning the address (e.g. "email is not valid").
    if (/\b(email|recipient|to)\b/i.test(text) && !/sender/i.test(text))
      return { result: "invalid", error: "invalid_recipient" };
    return {
      result: "retry",
      error: `http_400${code ? `_${code.replace(/[^a-z_]/gi, "").slice(0, 40)}` : ""}`,
    };
  }
  return { result: "retry", error: `http_${status}` };
}
