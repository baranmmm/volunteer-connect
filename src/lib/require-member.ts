import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed in AND has confirmed the current privacy notice. Every data server function uses this; only the privacy
 * functions themselves (status, confirm, preferences) use requireSupabaseAuth, so the confirmation screen works.
 */
export const requireMember = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("has_accepted_privacy_notice");
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Privacy notice not accepted");
    return next();
  });
