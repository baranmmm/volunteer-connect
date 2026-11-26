import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** get_privacy_status: the current version (defined once, in the database) and the member's confirmation and choices. */
export const privacyStatus = z.object({
  current_version: z.string(),
  accepted_version: z.string().nullable(),
  accepted_at: z.string().nullable(),
  current_accepted: z.boolean(),
  photo_consent: z.boolean(),
  photo_consent_changed_at: z.string().nullable(),
  updates_email_consent: z.boolean(),
  updates_email_consent_changed_at: z.string().nullable(),
});
export type PrivacyStatus = z.infer<typeof privacyStatus>;
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const getPrivacyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("get_privacy_status");
    fail(result.error);
    return privacyStatus.parse(result.data);
  });
/** The server refuses anything but the current version (e.g. a screen left open across a notice update). */
export const acceptPrivacyNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ version: z.string().max(20) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("accept_privacy_notice", { p_version: data.version });
    fail(result.error);
    return privacyStatus.parse(result.data);
  });
export const setConsentPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ updates: z.boolean() }))
  .handler(async ({ data, context }) => {
    // Photo consent is no longer asked (privacy notice 1.6): the stored value is passed back unchanged, never set.
    const current = await context.supabase.rpc("get_privacy_status");
    fail(current.error);
    const result = await context.supabase.rpc("set_consent_preferences", {
      p_photo_consent: privacyStatus.parse(current.data).photo_consent,
      p_updates_email_consent: data.updates,
    });
    fail(result.error);
    return privacyStatus.parse(result.data);
  });
