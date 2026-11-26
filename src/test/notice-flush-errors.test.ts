import { describe, expect, it, vi } from "vitest";

// flushNoticeEmails (after a member action) never throws, and a sender that cannot even load is logged (message only)
// instead of disappearing in Promise.allSettled.
vi.mock("@/lib/push/sender.server", () => {
  throw new Error("Failed to load module sender.server");
});
vi.mock("@/lib/email/outbox.server", () => ({
  requestOrigin: async () => null,
  flushOutbox: async () => {
    throw new Error("outbox exploded eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret");
  },
}));

describe("flushNoticeEmails", () => {
  it("logs a rejected email or push flush (no tokens) and resolves", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { flushNoticeEmails } = await import("@/lib/notice-emails.server");
      await expect(flushNoticeEmails()).resolves.toBeUndefined();
      const lines = error.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("[email] post-action flush failed: outbox exploded [redacted]");
      expect(lines[1]).toMatch(/^\[push\] post-action flush failed: /);
    } finally {
      error.mockRestore();
    }
  });
});
