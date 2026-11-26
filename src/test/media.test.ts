import { describe, expect, it } from "vitest";
import {
  chapterAccent,
  collageLargeSide,
  collageTiles,
  mediaYears,
  movesEventPagePhotos,
  nextSlide,
  shuffledOrder,
} from "@/lib/media";

// Pure helpers of the Media tab (src/lib/media.ts): timeline dot colour, collage layout, slideshow order.
describe("media helpers", () => {
  it("the newest chapter and chapters with photos from the last 7 days get the amber dot", () => {
    expect(chapterAccent({ is_new: false }, true)).toBe("amber");
    expect(chapterAccent({ is_new: true }, false)).toBe("amber");
    expect(chapterAccent({ is_new: false }, false)).toBe("primary");
    expect(chapterAccent({ is_new: null }, false)).toBe("primary");
  });

  it("the collage's large photo alternates sides; the last tile carries +N for the rest", () => {
    expect([0, 1, 2, 3].map(collageLargeSide)).toEqual(["left", "right", "left", "right"]);
    expect(collageTiles([1, 2, 3, 4], 24)).toEqual({ tiles: [1, 2, 3, 4], more: 20 });
    expect(collageTiles([1, 2], 2)).toEqual({ tiles: [1, 2], more: 0 });
    expect(collageTiles([1, 2, 3, 4, 5], 5)).toEqual({ tiles: [1, 2, 3, 4], more: 1 });
  });

  it("years newest first without duplicates", () => {
    expect(mediaYears([{ year: 2025 }, { year: 2026 }, { year: 2025 }])).toEqual([2026, 2025]);
  });

  it("slides wrap around both ways", () => {
    expect(nextSlide(4, 5)).toBe(0);
    expect(nextSlide(0, 5, -1)).toBe(4);
    expect(nextSlide(0, 0)).toBe(0);
  });

  it("shuffle keeps the current photo first and every photo exactly once", () => {
    let seed = 7;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const order = shuffledOrder(10, 3, random);
    expect(order[0]).toBe(3);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(shuffledOrder(0)).toEqual([]);
  });

  it("a move with event page photos needs the members-only warning", () => {
    expect(movesEventPagePhotos([{ source: "library", id: "a" }])).toBe(false);
    expect(
      movesEventPagePhotos([
        { source: "library", id: "a" },
        { source: "event", id: "b" },
      ]),
    ).toBe(true);
  });
});
