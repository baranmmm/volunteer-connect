import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { HubEvent } from "@/lib/event-rules";

// own is NULL for people without a branch (followers): not their own branch.
export const followedBranch = z.object({
  branch_id: z.string().uuid(),
  name: z.string(),
  region_id: z.string().uuid(),
  own: z
    .boolean()
    .nullable()
    .transform((v) => v === true),
});
export type FollowedBranch = z.infer<typeof followedBranch>;

export async function fetchFollowedBranches(): Promise<FollowedBranch[]> {
  const { data, error } = await supabase.rpc("get_followed_branches");
  if (error) throw error;
  return z.array(followedBranch).parse(data ?? []);
}
export async function followBranch(branchId: string) {
  const { error } = await supabase.rpc("follow_branch", { p_branch_id: branchId });
  if (error) throw error;
}
export async function unfollowBranch(branchId: string) {
  const { error } = await supabase.rpc("unfollow_branch", { p_branch_id: branchId });
  if (error) throw error;
}

export function useFollowedBranches(userId: string | undefined) {
  return useQuery({
    queryKey: ["followed-branches", userId],
    queryFn: fetchFollowedBranches,
    enabled: !!userId,
    staleTime: 300_000,
  });
}

/**
 * The calendar's default "Followed branches" view: every members event the user can see (their own scope), and
 * public events of followed branches (own branch included), region-wide public events of their regions and
 * national events. "All branches" shows every event the user can see.
 */
export function inFollowedBranches(
  event: Pick<HubEvent, "audience" | "scope" | "branch_id" | "region_id">,
  followed: FollowedBranch[],
) {
  if (event.audience !== "public" || event.scope === "national") return true;
  if (event.scope === "branch") return followed.some((b) => b.branch_id === event.branch_id);
  return followed.some((b) => b.region_id === event.region_id);
}
