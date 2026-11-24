import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => mocks } },
}));

import { removeStoredEventFile, uploadImageVariants } from "@/lib/event-files";
import {
  buildSignedImage,
  imageVariantPathList,
  imageVariantPaths,
  imageVariantSize,
} from "@/lib/image-variants";

// Resized image copies: paths (same rule as event_media_variant_paths in SQL), sizes, the srcset builder and the
// browser upload steps. No network: Storage is mocked, the canvas and bitmap are stubbed.
describe("image copy paths", () => {
  const db = new PGlite();
  afterAll(() => db.close());
  it.each([
    ["e1/m1.jpg", "e1/m1.w640.webp", "e1/m1.w1280.webp"],
    ["e1/m1.png", "e1/m1.w640.webp", "e1/m1.w1280.webp"],
    ["e1/m1.webp", "e1/m1.w640.webp", "e1/m1.w1280.webp"],
    ["e1/a.b.JPG", "e1/a.b.w640.webp", "e1/a.b.w1280.webp"],
  ])("%s → copies next to it, as the database computes them", async (path, w640, w1280) => {
    expect(imageVariantPaths(path)).toEqual({ w640, w1280 });
    expect(imageVariantPathList(path)).toEqual([w640, w1280]);
    // The SQL expression of public.event_media_variant_paths.
    const sql = await db.query<{ a: string; b: string }>(
      "SELECT regexp_replace($1, '\\.[A-Za-z0-9]+$', '') || '.w640.webp' AS a, regexp_replace($1, '\\.[A-Za-z0-9]+$', '') || '.w1280.webp' AS b",
      [path],
    );
    expect(sql.rows[0]).toEqual({ a: w640, b: w1280 });
  });
  it("limits the long side and never upscales", () => {
    expect(imageVariantSize(2000, 1333, 640)).toEqual({ width: 640, height: 427 });
    expect(imageVariantSize(1333, 2000, 1280)).toEqual({ width: 853, height: 1280 });
    expect(imageVariantSize(500, 300, 1280)).toEqual({ width: 500, height: 300 });
  });
});

describe("srcset builder", () => {
  it("without copies: the original only, no srcset", () => {
    expect(buildSignedImage({ original: "O", width: 2000, height: 1000 })).toEqual({
      src: "O",
      small: "O",
      srcSet: null,
      width: 2000,
      height: 1000,
    });
  });
  it("a large landscape photo: both copies and the original with their real widths", () => {
    const image = buildSignedImage({
      original: "O",
      w640: "S",
      w1280: "L",
      width: 2000,
      height: 1333,
    });
    expect(image).toMatchObject({ src: "L", small: "S" });
    expect(image.srcSet).toBe("S 640w, L 1280w, O 2000w");
  });
  it("a portrait photo is described by its width, not its long side", () => {
    expect(
      buildSignedImage({ original: "O", w640: "S", w1280: "L", width: 1333, height: 2000 }).srcSet,
    ).toBe("S 427w, L 853w, O 1333w");
  });
  it("lists each width once (a small original equals its copies)", () => {
    expect(
      buildSignedImage({ original: "O", w640: "S", w1280: "L", width: 1000, height: 800 }).srcSet,
    ).toBe("S 640w, L 1000w");
    expect(
      buildSignedImage({ original: "O", w640: "S", w1280: "L", width: 1, height: 1 }).srcSet,
    ).toBe("S 1w");
  });
  it("an unknown size: the copies as 640w and 1280w", () => {
    expect(buildSignedImage({ original: "O", w640: "S", w1280: "L" }).srcSet).toBe(
      "S 640w, L 1280w",
    );
  });
});

describe("browser upload of the copies", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function stubCanvas(type = "image/webp") {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 2000, height: 1000, close: vi.fn() }),
    );
    const sizes: [number, number][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      done: BlobCallback,
    ) {
      sizes.push([this.width, this.height]);
      done(new Blob(["x"], { type }));
    });
    return sizes;
  }
  const file = () => new File(["pixels"], "photo.jpg", { type: "image/jpeg" });

  it("uploads both copies after the original (no overwrite), then confirms", async () => {
    const sizes = stubCanvas();
    const confirm = vi.fn().mockResolvedValue(undefined);
    expect(await uploadImageVariants("e1/m1.jpg", file(), confirm)).toBe(true);
    expect(sizes).toEqual([
      [640, 320],
      [1280, 640],
    ]);
    expect(mocks.upload.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["e1/m1.w640.webp", { contentType: "image/webp", upsert: false }],
      ["e1/m1.w1280.webp", { contentType: "image/webp", upsert: false }],
    ]);
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("a browser without a WebP encoder: no copies, no confirmation, never throws", async () => {
    stubCanvas("image/png");
    const confirm = vi.fn();
    expect(await uploadImageVariants("e1/m1.jpg", file(), confirm)).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
  it("a failed copy upload removes the copies and keeps the original", async () => {
    stubCanvas();
    mocks.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("network") });
    const confirm = vi.fn();
    expect(await uploadImageVariants("e1/m1.jpg", file(), confirm)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith(["e1/m1.w640.webp", "e1/m1.w1280.webp"]);
  });
  it("a refused confirmation is not fatal", async () => {
    stubCanvas();
    expect(
      await uploadImageVariants("e1/m1.jpg", file(), () => Promise.reject(new Error("no"))),
    ).toBe(false);
  });
  it("removing an image removes the original and both copies; other files alone", async () => {
    await removeStoredEventFile("e1/m1.png");
    expect(mocks.remove).toHaveBeenLastCalledWith([
      "e1/m1.png",
      "e1/m1.w640.webp",
      "e1/m1.w1280.webp",
    ]);
    await removeStoredEventFile("e1/m2.pdf");
    expect(mocks.remove).toHaveBeenLastCalledWith(["e1/m2.pdf"]);
  });
});
