// The browser's Supabase client, loaded on demand: signed-out visitors of the public pages never download it unless
// they sign in, register an account or open a member page. Every caller gets the same client instance as the static
// `import { supabase } from "@/integrations/supabase/client"` used by member pages.
import type { supabase as SupabaseClientInstance } from "@/integrations/supabase/client";

export type BrowserSupabase = typeof SupabaseClientInstance;

let client: Promise<BrowserSupabase> | null = null;
const waiting: ((client: Promise<BrowserSupabase>) => void)[] = [];

/** Loads the client (once). The AuthProvider starts listening for sign-ins as soon as anything loads it. */
export function loadSupabase(): Promise<BrowserSupabase> {
  if (!client) {
    client = import("@/integrations/supabase/client").then((m) => m.supabase);
    for (const notify of waiting.splice(0)) notify(client);
  }
  return client;
}

/** Resolves with the client once something has asked for it through loadSupabase(). */
export function whenSupabaseRequested(): Promise<BrowserSupabase> {
  return (
    client ??
    new Promise<Promise<BrowserSupabase>>((resolve) => waiting.push(resolve)).then((c) => c)
  );
}

/** supabase-js keeps the session in localStorage under `sb-<project ref>-auth-token`. */
const SESSION_KEY = /^sb-.+-auth-token$/;

/** True when a stored Supabase session exists (or storage cannot be read, to be safe). */
export function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && SESSION_KEY.test(key)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** True once something has loaded the client (its listener and session are then always used). */
export function isSupabaseRequested(): boolean {
  return client !== null;
}

/**
 * The server-rendered public pages, the only ones that may start without the client. Every other page (members,
 * sign-in, password reset, email links) gets it at once, exactly as when the client was a static import.
 */
const PUBLIC_PATH = /^\/(?:events(?:\/[0-9a-f-]{36})?|sign-in|join|privacy\/attendees)?\/?$/i;

export function isLazyAuthPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}

/**
 * Whether the auth client is needed at once: any page other than the public ones, a stored session, a sign-in or
 * recovery link in the URL, or a frame (a Lovable preview, whose storage may be partitioned).
 */
export function needsAuthClientNow(): boolean {
  if (typeof window === "undefined") return false;
  if (!isLazyAuthPath(window.location.pathname)) return true;
  if (hasStoredSession()) return true;
  try {
    if (window.parent !== window) return true;
  } catch {
    return true;
  }
  const { hash, search } = window.location;
  return (
    /(access_token|refresh_token|error_description)=/.test(hash) ||
    /[?&](code|token_hash|error_description)=/.test(search)
  );
}

/**
 * Inline script for the page head (plain ES5, no user data): marks <html data-session> before the first paint when a
 * stored session exists, so server-rendered signed-out content stays hidden for members until their redirect or
 * member view (see the [data-signed-out-only] rules in styles.css). The AuthProvider keeps the mark up to date.
 */
export const SESSION_MARK_SCRIPT = `(function(){try{var s=window.localStorage;for(var i=0;i<s.length;i++){var k=s.key(i);if(k&&/^sb-.+-auth-token$/.test(k)){document.documentElement.setAttribute("data-session","");return}}}catch(e){}})();`;
