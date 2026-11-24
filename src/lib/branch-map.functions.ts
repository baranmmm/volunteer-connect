import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";

/**
 * Saves a branch's postcode (set_branch_postcode checks NC or the branch's RD and normalises it), then geocodes it
 * on the server (postcodes.io, cached) and stores the coordinates with the service role. `located` is false when the
 * postcode was saved but could not be placed on the map (the branch keeps its existing coordinates).
 */
export const saveBranchPostcode = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ branchId: z.string().uuid(), postcode: z.string().trim().max(16) }))
  .handler(async ({ data, context }) => {
    const saved = await context.supabase.rpc("set_branch_postcode", {
      p_branch: data.branchId,
      p_postcode: data.postcode,
    });
    if (saved.error) throw new Error(saved.error.message);
    const postcode = (saved.data as string | null) ?? null;
    if (!postcode) return { postcode: null, located: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { locateBranch } = await import("./geocode.server");
    const located = await locateBranch(supabaseAdmin, data.branchId, postcode);
    return { postcode, located };
  });
