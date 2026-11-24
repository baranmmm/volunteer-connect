import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD_LENGTH } from "@/components/app/PasswordInput";

/** Errors of the change-password form (i18n keys). */
export const CURRENT_PASSWORD_WRONG = "Current password is incorrect";

export type ChangePasswordErrors = Partial<Record<"current" | "next" | "confirm", string>>;
/** Form rules (the same strength rule as sign-up; Supabase Auth checks again). Values are i18n keys. */
export function validateChangePassword(v: {
  current: string;
  next: string;
  confirm: string;
}): ChangePasswordErrors {
  const errors: ChangePasswordErrors = {};
  if (!v.current) errors.current = "profile.password.errors.currentRequired";
  if (v.next.length < MIN_PASSWORD_LENGTH) errors.next = "errors.weakPassword";
  if (v.confirm !== v.next) errors.confirm = "auth.passwordsDontMatch";
  return errors;
}

/**
 * Changes the signed-in person's password.
 * 1. The current password is checked by signing in with it on a separate, throwaway client (no storage, no refresh),
 *    so the app's own session is never replaced — a National Coordinator keeps their aal2 (MFA) session.
 * 2. The new password is set through Supabase Auth: on that fresh session for people without MFA (this also meets
 *    "Secure password change", which wants a session signed in within the last 24 hours), and on the app's own
 *    aal2 session for people with an authenticator (the password is never changed from a password-only session).
 * 3. The throwaway session is always signed out; with signOutOthers every other session of the person is too.
 * Passwords are never logged.
 */
export async function changePassword(input: {
  email: string;
  current: string;
  next: string;
  signOutOthers: boolean;
}): Promise<void> {
  const url = import.meta.env["VITE_SUPABASE_URL"] as string;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
  const check = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "dsvh-password-check",
    },
  });
  const signedIn = await check.auth.signInWithPassword({
    email: input.email,
    password: input.current,
  });
  if (signedIn.error) {
    if (/invalid login credentials/i.test(signedIn.error.message))
      throw new Error(CURRENT_PASSWORD_WRONG);
    throw signedIn.error;
  }
  try {
    const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const usesMfa = level.data?.nextLevel === "aal2";
    if (usesMfa && level.data?.currentLevel !== "aal2")
      throw new Error("Two-factor authentication required");
    const updated = await (usesMfa ? supabase : check).auth.updateUser({ password: input.next });
    if (updated.error) throw updated.error;
  } finally {
    await check.auth.signOut({ scope: "local" });
  }
  if (input.signOutOthers) {
    const out = await supabase.auth.signOut({ scope: "others" });
    if (out.error) throw out.error;
  }
}
