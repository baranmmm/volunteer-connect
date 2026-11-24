// Server only: past public events for the map's "Past events" toggle. The events come from the anon-executable
// get_public_events (public fields only, imported past records included); which of them have photos in the landing
// gallery comes from public_landing_data (service role), as event ids only, so the card can link to "/#gallery-<id>".
import { anonClient, publicBranches } from "@/lib/public-events.server";
import { branchIdsFromSlugs, publicEventsSchema, type PublicEvent } from "@/lib/public-events";

/** The start of the past window: 12 months back (plus a day, so get_public_events' 12-month limit always holds). */
export function pastWindow(now = new Date()) {
  const from = new Date(now);
  from.setMonth(from.getMonth() - 12);
  from.setDate(from.getDate() + 1);
  return { from, to: now };
}

export async function fetchPastPublicEvents(opts: {
  branchSlugs?: string | null;
}): Promise<{ events: PublicEvent[]; galleryIds: string[] }> {
  const client = anonClient();
  let branchIds: string[] | undefined;
  if (opts.branchSlugs) {
    branchIds = branchIdsFromSlugs(opts.branchSlugs, await publicBranches());
    if (!branchIds.length) return { events: [], galleryIds: [] };
  }
  const { from, to } = pastWindow();
  const { data, error } = await client.rpc("get_public_events", {
    ...(branchIds ? { p_branch_ids: branchIds } : {}),
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_include_cancelled: false,
  });
  if (error) throw new Error("Public events unavailable");
  const events = publicEventsSchema.parse(data);
  return { events, galleryIds: await galleryEventIds() };
}

/** Event ids of the landing gallery groups (the anchors "/#gallery-<id>" exist exactly for these). */
async function galleryEventIds(): Promise<string[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("public_landing_data");
    if (error || !data || typeof data !== "object") return [];
    const gallery = (data as { gallery?: unknown }).gallery;
    if (!Array.isArray(gallery)) return [];
    return gallery.flatMap((g) =>
      g && typeof g === "object" && typeof (g as { event_id?: unknown }).event_id === "string"
        ? [(g as { event_id: string }).event_id]
        : [],
    );
  } catch {
    // Without the gallery ids, past cards link to the public event page instead.
    return [];
  }
}
