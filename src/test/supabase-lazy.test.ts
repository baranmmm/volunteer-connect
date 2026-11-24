// Which pages may start without the Supabase client: only the server-rendered public pages of a signed-out visitor.
// Every other page gets it at once, as when it was a static import (signed-in routes must never wait for it).
import { afterEach, describe, expect, it } from "vitest";
import { isLazyAuthPath, needsAuthClientNow } from "@/lib/supabase-lazy";

const EVENT = "/events/0b7c6a1e-1111-2222-3333-444455556666";

describe("lazy Supabase client", () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("only the public pages may load it lazily", () => {
    for (const p of ["/", "/events", EVENT, "/sign-in", "/join", "/privacy/attendees"])
      expect(isLazyAuthPath(p), p).toBe(true);
    for (const p of [
      "/dashboard",
      "/regions",
      "/auth",
      "/reset-password",
      "/privacy",
      "/calendar",
      `${EVENT}/x`,
    ])
      expect(isLazyAuthPath(p), p).toBe(false);
  });

  it("a member page needs it at once, even without a stored session", () => {
    window.history.replaceState(null, "", "/regions");
    expect(needsAuthClientNow()).toBe(true);
  });

  it("a public page needs it at once only with a stored session or an auth link", () => {
    window.history.replaceState(null, "", "/events");
    expect(needsAuthClientNow()).toBe(false);
    localStorage.setItem("sb-local-auth-token", "{}");
    expect(needsAuthClientNow()).toBe(true);
    localStorage.clear();
    window.history.replaceState(null, "", "/sign-in?code=abc");
    expect(needsAuthClientNow()).toBe(true);
  });
});
