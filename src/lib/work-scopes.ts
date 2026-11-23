import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { WORK_SCOPES } from "./tasks";

// Where the caller may create tasks and meetings (checked again by the create RPCs).
export const workScope = z.object({
  scope: z.enum(WORK_SCOPES),
  branch_id: z.string().uuid().nullable(),
  region_id: z.string().uuid().nullable(),
  label: z.string().nullable(),
});
export type WorkScopeOption = z.infer<typeof workScope>;
/** A stable key for a scope option (select values, test attributes). */
export const scopeKey = (s: Pick<WorkScopeOption, "scope" | "branch_id" | "region_id">) =>
  s.scope === "national"
    ? "national"
    : s.scope === "region"
      ? `region:${s.region_id}`
      : `branch:${s.branch_id}`;

export const listMyWorkScopes = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const result = await context.supabase.rpc("list_my_work_scopes");
    if (result.error) throw new Error(result.error.message);
    return z.array(workScope).parse(result.data ?? []);
  });
