import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import type { Attendee } from "./attendees";

const eventId = z.object({ eventId: z.string().uuid() });

/** Members and guests of an event for its scope managers (National Coordinators: counts only, the RPC refuses). */
export const listAttendees = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_attendees", { p_event_id: data.eventId });
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? []) as Attendee[];
  });

/** Check-in after the start: 'attended', or 'registered' to undo it. */
export const setAttendeeCheckIn = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ registrationId: z.string().uuid(), status: z.enum(["attended", "registered"]) }),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("mark_attendance", {
      p_registration_id: data.registrationId,
      p_status: data.status,
    });
    if (result.error) throw new Error(result.error.message);
  });

export type AnnounceTarget = "branch" | "region" | "all";
/** The announcement targets this manager may use: BM their branch; RD their region or a branch in it; NC any. */
export const announceOptions = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const roles = await context.supabase
      .from("user_roles")
      .select("role, region_id")
      .eq("user_id", context.userId);
    if (roles.error) throw new Error(roles.error.message);
    const nc = roles.data.some((r) => r.role === "national_coordinator");
    const directorRegion =
      roles.data.find((r) => r.role === "regional_director")?.region_id ?? null;
    let regions = context.supabase
      .from("regions")
      .select("id, name")
      .is("deleted_at", null)
      .order("name");
    let branches = context.supabase
      .from("branches")
      .select("id, name, region_id")
      .is("deleted_at", null)
      .order("name");
    if (!nc) {
      if (directorRegion) {
        regions = regions.eq("id", directorRegion);
        branches = branches.eq("region_id", directorRegion);
      } else {
        const profile = await context.supabase
          .from("profiles")
          .select("branch_id")
          .eq("id", context.userId)
          .single();
        if (profile.error) throw new Error(profile.error.message);
        if (!roles.data.some((r) => r.role === "branch_manager") || !profile.data.branch_id)
          return { all: false, regions: [], branches: [] };
        const own = await branches.eq("id", profile.data.branch_id);
        if (own.error) throw new Error(own.error.message);
        return { all: false, regions: [], branches: own.data };
      }
    }
    const [r, b] = await Promise.all([regions, branches]);
    if (r.error) throw new Error(r.error.message);
    if (b.error) throw new Error(b.error.message);
    return { all: nc, regions: r.data, branches: b.data };
  });

const announceInput = z.object({
  eventId: z.string().uuid(),
  target: z.enum(["branch", "region", "all"]),
  branchId: z.string().uuid().nullable(),
  regionId: z.string().uuid().nullable(),
  dryRun: z.boolean(),
});
/** "Announce to subscribers": a dry run counts the recipients; otherwise queues and starts sending (daily limit). */
export const announceEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(announceInput)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("announce_event", {
      p_event: data.eventId,
      p_target: data.target,
      ...(data.target === "branch" && data.branchId ? { p_branch: data.branchId } : {}),
      ...(data.target === "region" && data.regionId ? { p_region: data.regionId } : {}),
      p_dry_run: data.dryRun,
    });
    if (result.error) throw new Error(result.error.message);
    if (!data.dryRun) {
      const { flushEventEmails } = await import("./event-emails.server");
      await flushEventEmails(4, 50);
    }
    return Number(result.data ?? 0);
  });

export const listAnnouncements = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(eventId)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("get_event_announcements", { p_event: data.eventId });
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  });
