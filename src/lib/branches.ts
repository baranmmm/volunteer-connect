import { loadSupabase } from "@/lib/supabase-lazy";

export type RegionGroup = { id: string; name: string; branches: { id: string; name: string }[] };

export async function fetchRegionGroups(): Promise<RegionGroup[]> {
  const supabase = await loadSupabase();
  const { data, error } = await supabase
    .from("regions")
    .select("id, name, branches(id, name)")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    branches: [...(r.branches ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
