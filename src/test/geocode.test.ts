import { describe, expect, it, vi } from "vitest";
import {
  GEOCODE_MAX_AGE_MS,
  geocodePostcode,
  lookupPostcode,
  type CachedGeocode,
  type GeocodeCache,
} from "@/lib/geocode.server";
import { normalisePostcode, regionColors } from "@/lib/branch-map";

// The branch geocoder: postcodes.io through an injected fetch and an in-memory cache (no network, no database).
const NOW = new Date("2026-11-24T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

function fakeCache(rows: Record<string, CachedGeocode> = {}) {
  const store = new Map(Object.entries(rows));
  const cache: GeocodeCache = {
    get: vi.fn(async (pc: string) => store.get(pc) ?? null),
    put: vi.fn(async (pc: string, c: { latitude: number; longitude: number }) => {
      store.set(pc, { ...c, fetchedAt: NOW });
    }),
  };
  return { cache, store };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const found = (latitude: number, longitude: number) =>
  vi.fn(async () => json({ status: 200, result: { latitude, longitude } }));

describe("geocodePostcode", () => {
  it("looks the postcode up, stores it in the cache and returns the coordinates", async () => {
    const { cache, store } = fakeCache();
    const fetch = found(50.8225, -0.1372);
    const c = await geocodePostcode("BN1 1AA", { cache, fetch, now: () => NOW });
    expect(c).toEqual({ latitude: 50.8225, longitude: -0.1372 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.postcodes.io/postcodes/BN1%201AA",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(store.get("BN1 1AA")).toMatchObject({ latitude: 50.8225, longitude: -0.1372 });
  });

  it("reuses a cached row younger than 180 days without a request", async () => {
    const { cache } = fakeCache({
      "BN1 1AA": {
        latitude: 50.1,
        longitude: -0.1,
        fetchedAt: new Date(NOW.getTime() - 179 * day),
      },
    });
    const fetch = found(51, -1);
    expect(await geocodePostcode("BN1 1AA", { cache, fetch, now: () => NOW })).toEqual({
      latitude: 50.1,
      longitude: -0.1,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("refreshes a cached row older than 180 days", async () => {
    const { cache, store } = fakeCache({
      "BN1 1AA": {
        latitude: 50.1,
        longitude: -0.1,
        fetchedAt: new Date(NOW.getTime() - GEOCODE_MAX_AGE_MS - day),
      },
    });
    const fetch = found(50.9, -0.2);
    expect(await geocodePostcode("BN1 1AA", { cache, fetch, now: () => NOW })).toEqual({
      latitude: 50.9,
      longitude: -0.2,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get("BN1 1AA")?.latitude).toBe(50.9);
  });

  it("falls back to a stale cached row when the refresh fails", async () => {
    const { cache } = fakeCache({
      "BN1 1AA": {
        latitude: 50.1,
        longitude: -0.1,
        fetchedAt: new Date(NOW.getTime() - 400 * day),
      },
    });
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await geocodePostcode("BN1 1AA", { cache, fetch, now: () => NOW })).toEqual({
      latitude: 50.1,
      longitude: -0.1,
    });
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("returns null (nothing cached) for unknown postcodes, errors and places outside the UK", async () => {
    for (const fetch of [
      vi.fn(async () => json({ status: 404, error: "Postcode not found" }, 404)),
      vi.fn(async () => json({ status: 200, result: { latitude: null, longitude: null } })),
      vi.fn(async () => json({ status: 200, result: { latitude: 40.4, longitude: -3.7 } })),
      vi.fn(async () => new Response("not json", { status: 200 })),
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    ]) {
      const { cache } = fakeCache();
      expect(await geocodePostcode("ZZ1 1ZZ", { cache, fetch, now: () => NOW })).toBeNull();
      expect(cache.put).not.toHaveBeenCalled();
    }
  });

  it("still answers when the cache itself fails", async () => {
    const cache: GeocodeCache = {
      get: async () => {
        throw new Error("db down");
      },
      put: async () => {
        throw new Error("db down");
      },
    };
    expect(
      await geocodePostcode("BN1 1AA", { cache, fetch: found(50.8, -0.1), now: () => NOW }),
    ).toEqual({ latitude: 50.8, longitude: -0.1 });
  });

  it("aborts a slow lookup after the timeout", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(await lookupPostcode("BN1 1AA", fetch as typeof globalThis.fetch, 20)).toBeNull();
  });
});

describe("branch map helpers", () => {
  it("normalises postcodes the way set_branch_postcode stores them", () => {
    expect(normalisePostcode(" sw1a1aa ")).toBe("SW1A 1AA");
    expect(normalisePostcode("bn1  1aa")).toBe("BN1 1AA");
    expect(normalisePostcode("")).toBe("");
    expect(normalisePostcode("12345")).toBeNull();
  });

  it("gives every region its own colour in name order", () => {
    const colors = regionColors([
      { region_id: "b", region: "South" },
      { region_id: "a", region: "North" },
      { region_id: "b", region: "South" },
    ]);
    expect([...colors.values()].map((c) => c.name)).toEqual(["North", "South"]);
    expect(colors.get("a")?.fill).not.toBe(colors.get("b")?.fill);
  });
});
