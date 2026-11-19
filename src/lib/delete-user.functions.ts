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
    const actor = context.userId;
     const permission = await context.supabase.rpc("can_manage_user", { _actor: actor, _target: data.userId });
     if (permission.error || !permission.data) throw new Error("You cannot manage this user");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const check = await supabaseAdmin.rpc("authorize_user_deletion", { _actor: actor, _target: data.userId, ...(data.requestId ? { _request: data.requestId } : {}) });
    if (check.error) throw new Error(check.error.message);
    const auditId = check.data;
    if (!auditId) throw new Error("Deletion could not be logged. The account has not been deleted.");
    const args = { _actor: actor, _target: data.userId, _audit: auditId };
    try {
      const del = await supabaseAdmin.auth.admin.deleteUser(data.userId);
      if (del.error) throw new Error("Account deletion failed");
    } catch {
      try {
        const failure = await supabaseAdmin.rpc("record_user_deletion_failure", args);
        if (failure.error) throw new Error("Failure logging failed");
      } catch {
        console.error("Deletion failure could not be recorded", auditId);
        throw new Error("The account could not be deleted, and the failed attempt could not be recorded. Please try again.");
      }
      throw new Error("The account could not be deleted. The failed attempt was recorded; any related deletion request remains pending. Please try again.");
    }
    const rec = await supabaseAdmin.rpc("record_user_deletion", args);
    if (rec.error) {
      console.error("Deletion request completion failed", auditId);
      throw new Error("The account was deleted and its history was saved, but the deletion request could not be marked completed.");
    }
    return { ok: true };
  });
