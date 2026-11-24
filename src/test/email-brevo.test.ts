import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSender, sendWithBrevo, toBase64 } from "@/lib/email/brevo.server";

const config = {
  apiKey: "test-key",
  from: { email: "events@example.org", name: "Dialogue Society" },
};
const message = {
  to: { email: "guest@example.org", name: "Guest" },
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};

function mockFetch(status: number, body: unknown = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("Brevo sender", () => {
  it("parses EMAIL_FROM with or without a name", () => {
    expect(parseSender("Dialogue Society <events@example.org>")).toEqual({
      email: "events@example.org",
      name: "Dialogue Society",
    });
    expect(parseSender('"DS Hub" <hub@example.org>')).toEqual({
      email: "hub@example.org",
      name: "DS Hub",
    });
    expect(parseSender("events@example.org")).toEqual({ email: "events@example.org", name: null });
    expect(parseSender("not an address")).toBeNull();
    expect(parseSender("")).toBeNull();
  });

  it("posts the message with base64 attachments and List-Unsubscribe headers", async () => {
    const fetch = mockFetch(201, { messageId: "x" });
    const result = await sendWithBrevo(config, {
      ...message,
      attachments: [{ name: "invite.ics", content: "BEGIN:VCALENDAR — ğ" }],
      listUnsubscribe: {
        url: "https://hub.example.org/updates/unsubscribe?t=a",
        oneClick: "https://hub.example.org/api/public/unsubscribe?t=a",
      },
    });
    expect(result).toEqual({ result: "sent" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body));
    expect(body.sender).toEqual({ email: "events@example.org", name: "Dialogue Society" });
    expect(body.to).toEqual([{ email: "guest@example.org", name: "Guest" }]);
    expect(body.textContent).toBe("Hi");
    expect(body.attachment[0].content).toBe(toBase64("BEGIN:VCALENDAR — ğ"));
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.attachment[0].content), (c) => c.charCodeAt(0)),
      ),
    ).toBe("BEGIN:VCALENDAR — ğ");
    expect(body.headers["List-Unsubscribe"]).toBe(
      "<https://hub.example.org/api/public/unsubscribe?t=a>",
    );
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("rate limits and server errors are retried; a rejected recipient is skipped", async () => {
    mockFetch(429);
    expect(await sendWithBrevo(config, message)).toEqual({ result: "retry", error: "http_429" });
    mockFetch(503);
    expect(await sendWithBrevo(config, message)).toEqual({ result: "retry", error: "http_503" });
    mockFetch(400, { code: "invalid_parameter", message: "email is not valid in to" });
    expect(await sendWithBrevo(config, message)).toEqual({
      result: "invalid",
      error: "invalid_recipient",
    });
    mockFetch(401, { code: "unauthorized" });
    expect(await sendWithBrevo(config, message)).toMatchObject({ result: "retry", fatal: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    expect(await sendWithBrevo(config, message)).toEqual({ result: "retry", error: "network" });
  });
});
