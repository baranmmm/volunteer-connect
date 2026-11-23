import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed in, has confirmed the current privacy notice and, for a National Coordinator, has an MFA (aal2) session.
 * Every data server function uses this; only the privacy functions themselves (status, confirm, preferences) use
 * requireSupabaseAuth, so the confirmation screen works. The database enforces the same rules (RLS, is_nc()).
 */
export const requireMember = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const [privacy, session] = await Promise.all([
      context.supabase.rpc("has_accepted_privacy_notice"),
      context.supabase.rpc("session_ok"),
    ]);
    if (privacy.error) throw new Error(privacy.error.message);
    if (!privacy.data) throw new Error("Privacy notice not accepted");
    if (session.error) throw new Error(session.error.message);
    if (!session.data) throw new Error("Two-factor authentication required");
    return next();
  });
