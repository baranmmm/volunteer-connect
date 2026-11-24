// Server-only access for the public (signed-out) pages and the ICS feed. Reads go through the anon-executable
// get_public_* functions with the publishable key; only the first image's storage path (and its resized copies) is
// signed with the service role, after get_public_event_image has confirmed the event is public.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  branchIdsFromSlugs,
  publicEventSchema,
  publicEventsSchema,
  type PublicEvent,
} from "@/lib/public-events";
import type { SignedImage } from "@/lib/image-variants";

const isNewKey = (key: string) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");

export function anonClient() {
  const url = process.env["SUPABASE_URL"],
    key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Public events unavailable");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export async function publicBranches() {
  const { data, error } = await anonClient()
    .from("branches")
    .select("id, name, region_id")
    .order("name");
  if (error) throw new Error("Public events unavailable");
  return data;
}

/** Branches and regions for the filters (anon may read their names, nothing else). */
export async function publicStructure() {
  const client = anonClient();
  const [branches, regions] = await Promise.all([
    client.from("branches").select("id, name, region_id").order("name"),
    client.from("regions").select("id, name").order("name"),
  ]);
  if (branches.error || regions.error) throw new Error("Public events unavailable");
  return { branches: branches.data, regions: regions.data };
}

export async function fetchPublicEvents(opts: {
  branchSlugs?: string | null;
  months?: number;
  includeCancelled?: boolean;
}): Promise<PublicEvent[]> {
  const client = anonClient();
  let branchIds: string[] | undefined;
  if (opts.branchSlugs) {
    branchIds = branchIdsFromSlugs(opts.branchSlugs, await publicBranches());
    if (!branchIds.length) return [];
  }
  const from = new Date();
  const to = new Date(from);
  to.setMonth(to.getMonth() + Math.min(12, Math.max(1, opts.months ?? 6)));
  const { data, error } = await client.rpc("get_public_events", {
    ...(branchIds ? { p_branch_ids: branchIds } : {}),
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_include_cancelled: !!opts.includeCancelled,
  });
  if (error) throw new Error("Public events unavailable");
  return publicEventsSchema.parse(data);
}

export async function fetchPublicEvent(id: string): Promise<PublicEvent | null> {
  const { data, error } = await anonClient().rpc("get_public_event", { p_id: id });
  if (error) throw new Error("Public events unavailable");
  return data ? publicEventSchema.parse(data) : null;
}

/** 5-minute signed links to the public event's first image and its resized copies, or null. */
export async function signedPublicImage(id: string): Promise<SignedImage | null> {
  const { data: path, error } = await anonClient().rpc("get_public_event_image", { p_id: id });
  if (error) throw new Error("Public events unavailable");
  if (!path) return null;
  const { signEventImages } = await import("@/lib/image-variants.server");
  return (await signEventImages([path])).get(path) ?? null;
}
