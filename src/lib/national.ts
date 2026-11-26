import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

// National Coordinator data (aal2 only; the database refuses everything else). Volunteers and followers appear only
// as numbers; Regional Directors and Branch Managers in detail.
export const ncDashboard = z.object({
  regions: z.number(),
  branches: z.number(),
  volunteers: z.number(),
  /** Trustees: counted separately, never named. Defaults to 0 until the trustee migration is applied. */
  trustees: z.number().default(0),
  followers: z.number(),
  upcoming_events: z.number(),
  registrations_30d: z.number(),
  attended_30d: z.number(),
  pending_requests: z.number(),
  open_applications: z.number(),
});
export type NcDashboard = z.infer<typeof ncDashboard>;
const person = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Person = z.infer<typeof person>;
export const regionNode = z.object({
  id: z.string().uuid(),
  name: z.string(),
  directors: z.array(person),
  upcoming_events: z.number(),
  branches: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      managers: z.array(person),
      volunteers: z.number(),
      trustees: z.number().default(0),
      followers: z.number(),
      upcoming_events: z.number(),
    }),
  ),
});
export type RegionNode = z.infer<typeof regionNode>;

async function rpc<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

export const fetchNcDashboard = async () =>
  ncDashboard.parse(await rpc(supabase.rpc("get_nc_dashboard")));
export const fetchRegionsTree = async () =>
  z.array(regionNode).parse(await rpc(supabase.rpc("get_regions_tree")));
export const createRegion = (name: string) => rpc(supabase.rpc("create_region", { p_name: name }));
export const renameRegion = (id: string, name: string) =>
  rpc(supabase.rpc("rename_region", { p_id: id, p_name: name }));
export const deleteRegion = (id: string) => rpc(supabase.rpc("delete_region", { p_id: id }));
export const createBranch = (name: string, regionId: string) =>
  rpc(supabase.rpc("create_branch", { p_name: name, p_region_id: regionId }));
export const renameBranch = (id: string, name: string) =>
  rpc(supabase.rpc("rename_branch", { p_id: id, p_name: name }));
export const deleteBranch = (id: string) => rpc(supabase.rpc("delete_branch", { p_id: id }));

export function useNcDashboard(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["nc-dashboard", userId],
    queryFn: fetchNcDashboard,
    enabled: enabled && !!userId,
    staleTime: 60_000,
  });
}
export function useRegionsTree(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["regions-tree", userId],
    queryFn: fetchRegionsTree,
    enabled: enabled && !!userId,
  });
}
