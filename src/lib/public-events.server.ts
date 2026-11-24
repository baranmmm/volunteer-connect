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

/**
 * The cover of a public event for link previews: the 1280 px copy when it exists, else the original. Null unless
 * get_public_event_image confirms the event is public. The bytes go out through the server; the path never does.
 */
export async function publicEventCover(id: string): Promise<{ body: Blob; type: string } | null> {
  const { data: path, error } = await anonClient().rpc("get_public_event_image", { p_id: id });
  if (error) throw new Error("Public events unavailable");
  if (!path) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { imageVariantPaths } = await import("@/lib/image-variants");
  const { data: row } = await supabaseAdmin
    .from("event_media")
    .select("has_variants")
    .eq("kind", "image")
    .eq("storage_path", path)
    .maybeSingle();
  const bucket = supabaseAdmin.storage.from("event-media");
  if (row?.has_variants) {
    const copy = await bucket.download(imageVariantPaths(path).w1280);
    if (!copy.error && copy.data) return { body: copy.data, type: "image/webp" };
  }
  const original = await bucket.download(path);
  if (original.error || !original.data) return null;
  return { body: original.data, type: imageType(path, original.data.type) };
}

function imageType(path: string, reported: string) {
  if (/^image\/(jpeg|png|webp|gif)$/.test(reported)) return reported;
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

/** 5-minute signed links to the public event's first image and its resized copies, or null. */
export async function signedPublicImage(id: string): Promise<SignedImage | null> {
  const { data: path, error } = await anonClient().rpc("get_public_event_image", { p_id: id });
  if (error) throw new Error("Public events unavailable");
  if (!path) return null;
  const { signEventImages } = await import("@/lib/image-variants.server");
  return (await signEventImages([path])).get(path) ?? null;
}
