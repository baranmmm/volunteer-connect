import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { pastEventDateOk } from "./past-events";

/**
 * Past events: a public record of an event that already took place (title, date, branch or national, description).
 * Photos go through the usual reserve → upload flow (reserveEventMedia, up to 12), videos through addEventVideo.
 */
const fields = z
  .object({
    title: z.string().trim().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** null: a national record (National Coordinators). */
    branchId: z.string().uuid().nullable(),
    description: z.string().max(5000),
  })
  .refine((v) => pastEventDateOk(v.date), {
    path: ["date"],
    message: "Past event date must be in the past",
  });

export const createPastEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(fields)
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("create_past_event", {
      p_title: data.title,
      p_date: data.date,
      // The generated type marks it non-null; NULL is a national record.
      p_branch: data.branchId as string,
      p_description: data.description,
    });
    if (result.error) throw new Error(result.error.message);
    return String(result.data);
  });

export const updatePastEvent = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }).and(fields))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("update_past_event", {
      p_id: data.id,
      p_title: data.title,
      p_date: data.date,
      p_branch: data.branchId as string,
      p_description: data.description,
    });
    if (result.error) throw new Error(result.error.message);
  });
