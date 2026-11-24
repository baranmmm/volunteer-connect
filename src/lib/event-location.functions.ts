import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";

/**
 * Saves an in-person event's map postcode (set_event_postcode checks that the caller manages the event and normalises
 * it; "" removes it), then geocodes it on the server (postcodes.io, cached) and stores the coordinates with the service
 * role. `located` is false when the postcode was saved but could not be placed: the map keeps the branch location.
 */
export const saveEventPostcode = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid(), postcode: z.string().trim().max(16) }))
  .handler(async ({ data, context }) => {
    const saved = await context.supabase.rpc("set_event_postcode", {
      p_event: data.eventId,
      p_postcode: data.postcode,
    });
    if (saved.error) throw new Error(saved.error.message);
    const postcode = (saved.data as string | null) ?? null;
    if (!postcode) return { postcode: null, located: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { locateEvent } = await import("./geocode.server");
    const located = await locateEvent(supabaseAdmin, data.eventId, postcode);
    return { postcode, located };
  });
