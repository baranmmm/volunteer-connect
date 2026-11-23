import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  recycleItemInput,
  permanentDeleteInput,
  recycleRow,
  DATABASE_ONLY_TYPES,
} from "./recycle-bin";
import { eventDeletionResult } from "./event-deletion";

export const listRecycleBin = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      type: z.enum([
        "all",
        "event",
        "user",
        "event_request",
        "volunteer_application",
        "branch",
        "region",
      ]),
      search: z.string().max(200),
      offset: z.number().int().min(0).max(1000000),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_recycle_bin", {
      _type: data.type,
      _search: data.search,
      _offset: data.offset,
    });
    if (result.error) throw new Error(result.error.message);
    return z.array(recycleRow).parse(result.data);
  });

export const restoreRecycleItem = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(recycleItemInput)
  .handler(async ({ data, context }) => {
    const prepared = await context.supabase.rpc("restore_item", { _type: data.type, _id: data.id });
    if (prepared.error) throw new Error(prepared.error.message);
    // Event requests have no files or Auth account: restore_item already finished the restore.
    if (
      data.type === "event_request" ||
      (DATABASE_ONLY_TYPES as readonly string[]).includes(data.type)
    )
      return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.type === "event" || data.type === "series") {
      const { relocateEventFiles } = await import("./event-storage.server");
      await relocateEventFiles(supabaseAdmin, eventDeletionResult.parse(prepared.data).paths, true);
      const finished =
        data.type === "event"
          ? await context.supabase.rpc("restore_event", { _event: data.id, _finalize: true })
          : await context.supabase.rpc("restore_series", { _series: data.id, _finalize: true });
      if (finished.error) throw new Error(finished.error.message);
    } else {
      // Unban first; until finalization, RLS still denies all personal data and app permissions.
      const unbanned = await supabaseAdmin.auth.admin.updateUserById(data.id, {
        ban_duration: "none",
      });
      if (unbanned.error) throw new Error("Account restoration failed");
      const finished = await supabaseAdmin.rpc("finish_user_recycle_operation", {
        _id: data.id,
        _operation: "restore",
      });
      if (finished.error) throw new Error(finished.error.message);
    }
    return { ok: true };
  });

export const permanentlyDeleteRecycleItem = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(permanentDeleteInput)
  .handler(async ({ data, context }) => {
    const prepared = await context.supabase.rpc("permanent_delete_item", {
      _type: data.type,
      _id: data.id,
      _confirmation: data.confirmation,
    });
    if (prepared.error) throw new Error(prepared.error.message);
    // Applications, branches and regions have no files: the RPC deleted them (or refused).
    if ((DATABASE_ONLY_TYPES as readonly string[]).includes(data.type)) return { ok: true };
    // Event requests without stored attachments are deleted by the RPC; otherwise remove the files, then the row.
    if (data.type === "event_request") {
      if (eventDeletionResult.parse(prepared.data).deleted) return { ok: true };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { purgeEventRequest } = await import("./recycle-bin.server");
      await purgeEventRequest(supabaseAdmin, data.id);
      return { ok: true };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { purgeRecycleItem } = await import("./recycle-bin.server");
    if (data.type === "series") {
      // Every event deleted with the series (and its media holder) was queued for manual purge.
      const { events } = z.object({ events: z.array(z.string().uuid()) }).parse(prepared.data);
      for (const id of events) await purgeRecycleItem(supabaseAdmin, "event", id);
      const finished = await supabaseAdmin.rpc("finish_series_purge", { _series: data.id });
      if (finished.error) throw new Error(finished.error.message);
    } else if (data.type === "event" || data.type === "user")
      await purgeRecycleItem(supabaseAdmin, data.type, data.id);
    return { ok: true };
  });
