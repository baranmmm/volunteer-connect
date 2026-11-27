import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HubEvent } from "@/lib/event-rules";
import type { MediaPhotoRow } from "@/lib/media";

// How many Storage objects a page load signs (each one runs the Storage read policy): the Media timeline only its
// chapters' preview tiles, the dashboard strip only its 12 tiles, the Calendar only the covers of the cards it shows.
const covers = vi.hoisted(() => ({
  fn: vi.fn(async ({ data }: { data: { ids: string[] } }) =>
    Object.fromEntries(data.ids.map((id) => [id, `https://signed/${id}`])),
  ),
}));
vi.mock("@tanstack/react-start", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/events.functions", () => ({ getEventCovers: covers.fn }));

import { signChapters, signPhotos } from "@/lib/media.functions";
import { MEDIA_CHAPTERS_PAGE, photoSignPaths } from "@/lib/media";
import { cardEvents, coverCandidates, useEventCovers } from "@/lib/use-event-covers";

function fakeStorage() {
  const signed: { bucket: string; paths: string[] }[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => {
          signed.push({ bucket, paths });
          return {
            data: paths.map((p) => ({
              path: p,
              signedUrl: `http://storage/sign/${bucket}/${p}?t=1`,
              error: null,
            })),
            error: null,
          };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, signed, count: () => signed.reduce((n, s) => n + s.paths.length, 0) };
}

let n = 0;
function photo(bucket: MediaPhotoRow["bucket"], copies = true): MediaPhotoRow {
  const base = `b/${++n}`;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    source: bucket === "event-media" ? "event" : "library",
    bucket,
    original: `${base}.webp`,
    w640: copies ? `${base}.w640.webp` : null,
    w1280: copies ? `${base}.w1280.webp` : null,
    width: 1600,
    height: 1200,
    created_at: "2026-11-01T00:00:00Z",
  };
}

describe("Media timeline and dashboard strip", () => {
  it("signs only the 640 copy of a tile (the original without copies); viewers get both copies", () => {
    expect(photoSignPaths(photo("event-media"), "tiles")).toHaveLength(1);
    expect(photoSignPaths(photo("event-media"), "viewer")).toHaveLength(2);
    expect(photoSignPaths(photo("event-media", false), "tiles")).toEqual([`b/${n}.webp`]);
  });

  it("signs at most 5 objects per chapter, one batch per bucket", async () => {
    const storage = fakeStorage();
    const chapters = Array.from({ length: MEDIA_CHAPTERS_PAGE }, (_, i) => ({
      kind: (i % 2 ? "album" : "event") as "album" | "event",
      id: `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`,
      photos: Array.from({ length: 5 }, (_, j) => photo(j % 2 ? "media-library" : "event-media")),
    }));
    const signed = await signChapters(storage.client, chapters as never, "tiles");
    expect(MEDIA_CHAPTERS_PAGE).toBeLessThanOrEqual(4);
    expect(storage.count()).toBeLessThanOrEqual(5 * chapters.length);
    expect(storage.signed.map((s) => s.bucket).sort()).toEqual(["event-media", "media-library"]);
    for (const c of signed) for (const p of c.photos) expect(p.thumb).toMatch(/\.w640\.webp/);
  });

  it("signs at most 12 objects for the 12-photo strip", async () => {
    const storage = fakeStorage();
    const rows = Array.from({ length: 12 }, (_, i) =>
      photo(i % 3 ? "event-media" : "media-library"),
    );
    const photos = await signPhotos(storage.client, rows, "tiles");
    expect(storage.count()).toBeLessThanOrEqual(12);
    expect(photos.every((p) => p.thumb && p.src === null)).toBe(true);
  });
});

function event(id: string, over: Partial<HubEvent> = {}): HubEvent {
  return {
    id,
    title: id,
    all_day: true,
    start_date: "2026-03-11",
    end_date: "2026-03-11",
    start_at: null,
    end_at: null,
    series_id: null,
    past_record: false,
    status: "published",
    media: [
      {
        id: `${id}-m`,
        event_id: id,
        kind: "image",
        storage_path: `${id}/a.webp`,
        position: 0,
        url: null,
      },
    ],
    ...over,
  } as unknown as HubEvent;
}

describe("Calendar covers", () => {
  const wrapper = (client: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };

  it("signs nothing in the month view for past records (the grid shows no covers)", async () => {
    covers.fn.mockClear();
    const past = [
      event("p1", { past_record: true }),
      event("p2", { past_record: true }),
      event("p3"),
    ];
    expect(cardEvents("month", past)).toEqual([]);
    const client = new QueryClient();
    const { result } = renderHook(() => useEventCovers(cardEvents("month", past), "u1"), {
      wrapper: wrapper(client),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.size).toBe(0);
    expect(covers.fn).not.toHaveBeenCalled();
  });

  it("signs only the shown cards with an image, once, and reuses them while fresh", async () => {
    covers.fn.mockClear();
    const shown = [event("a"), event("b"), event("c", { media: [] })];
    expect(coverCandidates(shown)).toEqual(["a", "b"]);
    const client = new QueryClient();
    const first = renderHook(() => useEventCovers(cardEvents("list", shown), "u1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.size).toBe(2));
    expect(covers.fn).toHaveBeenCalledTimes(1);
    expect(covers.fn.mock.calls[0]![0].data.ids).toEqual(["a", "b"]);
    first.unmount();
    // Back on the page (or the other view): the cached covers, no new signing.
    const again = renderHook(() => useEventCovers(cardEvents("list", shown), "u1"), {
      wrapper: wrapper(client),
    });
    expect(again.result.current.get("a")).toBe("https://signed/a");
    await new Promise((r) => setTimeout(r, 20));
    expect(covers.fn).toHaveBeenCalledTimes(1);
  });
});
