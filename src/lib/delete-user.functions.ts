import { createServerFn } from "@tanstack/react-start";
import { requireMember } from "@/lib/require-member";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Soft deletion and audit are atomic in the existing RPC; Auth blocking precedes completion.
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator((d: { userId: string; requestId?: string | null }) => {
    if (!UUID.test(d.userId) || (d.requestId != null && !UUID.test(d.requestId)))
      throw new Error("Invalid request");
    return { userId: d.userId, requestId: d.requestId ?? null };
  })
  .handler(async ({ data, context }) => {
    const actor = context.userId;
    const permission = await context.supabase.rpc("can_manage_user", {
      _actor: actor,
      _target: data.userId,
    });
    if (permission.error || !permission.data) throw new Error("You cannot manage this user");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const check = await supabaseAdmin.rpc("authorize_user_deletion", {
      _actor: actor,
      _target: data.userId,
      ...(data.requestId ? { _request: data.requestId } : {}),
    });
    if (check.error) throw new Error(check.error.message);
    const auditId = check.data;
    if (!auditId)
      throw new Error("Deletion could not be logged. The account has not been deleted.");
    const args = { _actor: actor, _target: data.userId, _audit: auditId };
    try {
      const del = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        ban_duration: "876000h",
      });
      if (del.error) throw new Error("Account deletion failed");
    } catch {
      try {
        const failure = await supabaseAdmin.rpc("record_user_deletion_failure", args);
        if (failure.error) throw new Error("Failure logging failed");
      } catch {
        console.error("Deletion failure could not be recorded", auditId);
        throw new Error(
          "The account could not be deleted, and the failed attempt could not be recorded. Please try again.",
        );
      }
      throw new Error(
        "The account could not be deleted. The failed attempt was recorded; any related deletion request remains pending. Please try again.",
      );
    }
    const rec = await supabaseAdmin.rpc("record_user_deletion", args);
    if (rec.error) {
      console.error("Deletion request completion failed", auditId);
      throw new Error(
        "The account was deleted and its history was saved, but the deletion request could not be marked completed.",
      );
    }
    return { ok: true };
  });

/**
 * Followers delete their own account (they have no manager to process a request). The typed name must match the
 * profile exactly (trimmed); the erasure is self-requested, so it is non-restorable and purged after 30 days.
 */
export const deleteMyFollowerAccount = createServerFn({ method: "POST" })
  // Erasure does not depend on the privacy notice (the confirmation screen links here), so no requireMember.
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirmName: string }) => {
    if (typeof d?.confirmName !== "string" || d.confirmName.length > 300)
      throw new Error("Invalid request");
    return { confirmName: d.confirmName.trim() };
  })
  .handler(async ({ data, context }) => {
    const me = context.userId;
    const profile = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", me)
      .single();
    if (profile.error) throw new Error("Not allowed");
    if (!data.confirmName || data.confirmName !== profile.data.full_name.trim())
      throw new Error("The name does not match");
    const follower = await context.supabase.rpc("is_follower", { _uid: me });
    if (follower.error || !follower.data) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const check = await supabaseAdmin.rpc("authorize_follower_self_deletion", { _target: me });
    if (check.error || !check.data) throw new Error(check.error?.message ?? "Not allowed");
    const args = { _actor: me, _target: me, _audit: check.data };
    const banned = await supabaseAdmin.auth.admin.updateUserById(me, { ban_duration: "876000h" });
    if (banned.error) {
      await supabaseAdmin.rpc("record_user_deletion_failure", args);
      throw new Error("The account could not be deleted. Please try again.");
    }
    const rec = await supabaseAdmin.rpc("record_user_deletion", args);
    if (rec.error) throw new Error("The account was deleted, but completing the record failed.");
    return { ok: true };
  });
