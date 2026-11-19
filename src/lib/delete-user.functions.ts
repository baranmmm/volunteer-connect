import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deletes a user's sign-in account (profile and roles cascade). Permission rules live in the database.
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; requestId?: string | null }) => {
    if (!UUID.test(d.userId) || (d.requestId != null && !UUID.test(d.requestId))) throw new Error("Invalid request");
    return { userId: d.userId, requestId: d.requestId ?? null };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actor = context.userId;
    const check = await supabaseAdmin.rpc("authorize_user_deletion", { _actor: actor, _target: data.userId, ...(data.requestId ? { _request: data.requestId } : {}) });
    if (check.error) throw new Error(check.error.message);
    const del = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (del.error) { console.error("deleteUser failed", del.error.message); throw new Error("The user could not be deleted"); }
    const rec = await supabaseAdmin.rpc("record_user_deletion", { _actor: actor, _target: data.userId, ...(data.requestId ? { _request: data.requestId } : {}) });
    if (rec.error) console.error("record_user_deletion failed", rec.error.message);
    return { ok: true };
  });
