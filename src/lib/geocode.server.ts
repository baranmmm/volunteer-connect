// Server only: UK postcode → coordinates with postcodes.io, cached in postcode_geocodes (service role).
// The fetch and the cache are injectable so tests never touch the network or the database.
import { z } from "zod";

export type Coordinates = { latitude: number; longitude: number };
export type CachedGeocode = Coordinates & { fetchedAt: Date };

export type GeocodeCache = {
  get: (postcode: string) => Promise<CachedGeocode | null>;
  put: (postcode: string, coordinates: Coordinates) => Promise<void>;
};

export type GeocodeOptions = {
  cache: GeocodeCache;
  fetch?: typeof fetch | undefined;
  now?: () => Date;
  /** Cached rows older than this are refreshed (180 days). */
  maxAgeMs?: number;
  timeoutMs?: number;
};

export const GEOCODE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
export const GEOCODE_TIMEOUT_MS = 5000;
const API = "https://api.postcodes.io/postcodes/";

const response = z.object({
  result: z
    .object({ latitude: z.number().nullable(), longitude: z.number().nullable() })
    .nullable(),
});

/** Inside the bounds the branches table accepts (the UK). */
const inUk = (c: Coordinates) =>
  c.latitude >= 49 && c.latitude <= 61 && c.longitude >= -9 && c.longitude <= 3;

/** postcodes.io lookup; null when the postcode is unknown, has no location, or the request fails or times out. */
export async function lookupPostcode(
  postcode: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = GEOCODE_TIMEOUT_MS,
): Promise<Coordinates | null> {
  try {
    const res = await fetchImpl(`${API}${encodeURIComponent(postcode)}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed = response.safeParse(await res.json());
    const r = parsed.success ? parsed.data.result : null;
    if (!r || r.latitude == null || r.longitude == null) return null;
    const c = { latitude: r.latitude, longitude: r.longitude };
    return inUk(c) ? c : null;
  } catch {
    return null;
  }
}

/**
 * Coordinates for a normalised postcode: a fresh cached row first; otherwise postcodes.io (stored in the cache).
 * When the lookup fails, a stale cached row is still better than nothing. Null when nothing is known.
 */
export async function geocodePostcode(
  postcode: string,
  options: GeocodeOptions,
): Promise<Coordinates | null> {
  const now = (options.now ?? (() => new Date()))();
  const maxAge = options.maxAgeMs ?? GEOCODE_MAX_AGE_MS;
  const cached = await options.cache.get(postcode).catch(() => null);
  if (cached && now.getTime() - cached.fetchedAt.getTime() < maxAge) {
    return { latitude: cached.latitude, longitude: cached.longitude };
  }
  const found = await lookupPostcode(postcode, options.fetch, options.timeoutMs);
  if (found) {
    await options.cache.put(postcode, found).catch(() => undefined);
    return found;
  }
  return cached ? { latitude: cached.latitude, longitude: cached.longitude } : null;
}

type AdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

/** The postcode_geocodes table through the service-role client. */
export function supabaseGeocodeCache(admin: AdminClient): GeocodeCache {
  return {
    async get(postcode) {
      const { data, error } = await admin
        .from("postcode_geocodes")
        .select("latitude, longitude, fetched_at")
        .eq("postcode", postcode)
        .maybeSingle();
      if (error || !data) return null;
      return {
        latitude: data.latitude,
        longitude: data.longitude,
        fetchedAt: new Date(data.fetched_at),
      };
    },
    async put(postcode, c) {
      const { error } = await admin.from("postcode_geocodes").upsert({
        postcode,
        latitude: c.latitude,
        longitude: c.longitude,
        fetched_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Geocodes a branch's (already saved, normalised) postcode and stores the coordinates; set_branch_coordinates only
 * applies while the branch still has that postcode. False when the postcode could not be located (the branch keeps
 * its existing coordinates).
 */
export async function locateBranch(
  admin: AdminClient,
  branchId: string,
  postcode: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const c = await geocodePostcode(postcode, {
    cache: supabaseGeocodeCache(admin),
    fetch: fetchImpl,
  });
  if (!c) return false;
  const { error } = await admin.rpc("set_branch_coordinates", {
    p_branch: branchId,
    p_postcode: postcode,
    p_lat: c.latitude,
    p_lng: c.longitude,
  });
  return !error;
}
