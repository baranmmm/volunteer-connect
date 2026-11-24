import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  imageKey,
  mapBranch,
  mapScope,
  cleanTitle,
  isChildrenEvent,
  parseDayText,
  parseEventPage,
  parseEventsList,
  pickDownloadUrl,
  selectPhotos,
  type EventPage,
} from "../../scripts/import-ds-past-events/parse";
import {
  MAX_SUMMARY_CHARS,
  sentenceCount,
  summarize,
  themeWords,
} from "../../scripts/import-ds-past-events/summarize";
import { parseChannelFeed, posterUrl } from "../../scripts/import-ds-past-events/youtube";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/ds-site", name), "utf8");

describe("events list", () => {
  const list = parseEventsList(fixture("events-list.html"));

  it("parses items newest first with trimmed links, titles, dates, branches and images", () => {
    expect(list.items).toHaveLength(3);
    expect(list.items[0]).toEqual({
      url: "https://www.dialoguesociety.org/event/bolton-celebrates-diversity-and-togetherness-at-interfaith-reception/",
      title: "Bolton Celebrates Diversity and Togetherness at Interfaith Reception",
      date: "2026-11-15",
      branches: ["Manchester"],
      image:
        "https://www.dialoguesociety.org/wp-content/uploads/2026/11/pid-featured-manchester-11152026-300-am-11.jpg",
    });
    expect(list.items.map((i) => i.date)).toEqual(["2026-11-15", "2026-11-12", "2026-11-12"]);
    expect(list.items[2]?.branches).toEqual(["Greater London"]);
  });

  it("finds the next page", () => {
    expect(list.nextUrl).toBe("https://www.dialoguesociety.org/events/page/2/");
  });
});

describe("dates", () => {
  it("reads the event day and ignores the 13:00PM time quirk", () => {
    expect(parseDayText(" 12 November 2026")).toBe("2026-11-12");
    expect(parseDayText(" 12 November 2026 @ 13:00PM")).toBe("2026-11-12");
    expect(parseDayText("3 July 2026")).toBe("2026-07-03");
    expect(parseDayText("31 February 2026")).toBeNull();
    expect(parseDayText("")).toBeNull();
  });

  it("takes the header date of an event whose time reads 13:00PM", () => {
    const html = fixture("event-video.html");
    expect(html).toContain("13:00PM");
    expect(parseEventPage(html).date).toBe("2026-11-12");
  });
});

describe("event page", () => {
  const gallery = parseEventPage(fixture("event-gallery.html"));
  const video = parseEventPage(fixture("event-video.html"));

  it("parses title, date, branch, category and venue from the header", () => {
    expect(gallery.title).toBe(
      "Bolton Celebrates Diversity and Togetherness at Interfaith Reception",
    );
    expect(gallery.date).toBe("2026-11-15");
    expect(gallery.branch).toBe("Manchester");
    expect(gallery.categories).toEqual(["Community Engagement"]);
    expect(gallery.venue).toBe("The Albert Halls");
    expect(gallery.eventType).toBe("Open to Everyone");
    expect(video.branch).toBe("Greater London");
  });

  it("collects gallery images with original URLs and sizes, not speaker photos", () => {
    expect(gallery.galleryImages).toHaveLength(8);
    expect(gallery.contentImages).toHaveLength(0);
    for (const img of gallery.galleryImages) {
      expect(img.originalUrl).toMatch(
        /^https:\/\/www\.dialoguesociety\.org\/wp-content\/uploads\//,
      );
      expect(img.originalUrl).not.toMatch(/-\d+x\d+\.(jpe?g|png)$/);
    }
    expect(JSON.stringify(gallery)).not.toContain("headshots");
    expect(video.galleryImages[0]).toMatchObject({ width: 5120, height: 3840 });
  });

  it("downloads the smallest size that still reaches 1920 px", () => {
    expect(video.galleryImages[0]?.downloadUrl).toMatch(/-2048x1536\.jpeg$/);
    // A 1920 px original is used as is.
    expect(gallery.galleryImages[0]?.downloadUrl).toBe(gallery.galleryImages[0]?.originalUrl);
    // Portrait: the 1152w size is 1536 px tall (too small), so the next size or the original is taken.
    expect(
      pickDownloadUrl(
        "https://x.example/a.jpeg",
        3024,
        4032,
        "https://x.example/a-768x1024.jpeg 768w, https://x.example/a-1152x1536.jpeg 1152w, https://x.example/a-1536x2048.jpeg 1536w",
      ),
    ).toBe("https://x.example/a-1536x2048.jpeg");
  });

  it("finds YouTube embeds", () => {
    expect(video.youtubeIds).toEqual(["Zz9SmKKNJ-4"]);
    expect(gallery.youtubeIds).toEqual([]);
  });

  it("keeps body paragraphs", () => {
    expect(video.paragraphs.length).toBeGreaterThan(0);
    expect(video.paragraphs.join(" ")).toContain("migrant");
  });
});

describe("photo selection", () => {
  const gallery = parseEventPage(fixture("event-gallery.html"));

  it("takes at most 6 gallery photos spread over the gallery", () => {
    const photos = selectPhotos(gallery);
    expect(photos).toHaveLength(6);
    expect(new Set(photos.map((p) => imageKey(p.originalUrl))).size).toBe(6);
    expect(photos[0]).toBe(gallery.galleryImages[0]);
  });

  it("falls back to the featured and body images, and needs at least 3", () => {
    const img = (n: number) => ({
      originalUrl: `https://www.dialoguesociety.org/wp-content/uploads/2026/01/p${n}.jpg`,
      width: 1000,
      height: 800,
      downloadUrl: `https://www.dialoguesociety.org/wp-content/uploads/2026/01/p${n}.jpg`,
    });
    const base: EventPage = {
      ...gallery,
      galleryImages: [img(1)],
      featuredImage: img(1),
      contentImages: [],
    };
    expect(selectPhotos(base)).toEqual([]);
    const withBody = { ...base, contentImages: [img(2), img(3)] };
    expect(selectPhotos(withBody).map((p) => p.originalUrl)).toEqual([
      img(1).originalUrl,
      img(2).originalUrl,
      img(3).originalUrl,
    ]);
  });

  it("recognises one photo in several sizes", () => {
    expect(imageKey("https://a.example/x/photo-2-scaled.jpeg")).toBe(
      imageKey("https://a.example/x/photo-2.jpg"),
    );
    expect(imageKey("https://a.example/x/photo-1024x768.jpg")).toBe(
      "https://a.example/x/photo.jpg",
    );
  });
});

describe("summary", () => {
  const pages = [
    parseEventPage(fixture("event-gallery.html")),
    parseEventPage(fixture("event-video.html")),
  ];

  it("is at most 2 sentences and 300 characters", () => {
    for (const page of pages) {
      const text = summarize(page);
      expect(text.length).toBeGreaterThan(20);
      expect(text.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
      expect(sentenceCount(text)).toBeLessThanOrEqual(2);
    }
  });

  it("states the facts in its own words", () => {
    const text = summarize(pages[0]!);
    expect(text).toContain("Dialogue Society Manchester");
    expect(text).toContain("15 November 2026");
    expect(text).toContain("The Albert Halls");
    // No sentence of the page is copied: no run of 8 consecutive words is shared with the body.
    const body = pages[0]!.paragraphs.join(" ").toLowerCase();
    const w = text.toLowerCase().split(/\s+/);
    for (let i = 0; i + 8 <= w.length; i++) expect(body).not.toContain(w.slice(i, i + 8).join(" "));
  });

  it("uses lowercase topic words, not names or places", () => {
    const themes = themeWords(pages[1]!);
    expect(themes.length).toBeGreaterThan(0);
    for (const t of themes) expect(t).toBe(t.toLowerCase());
    expect(themes).not.toContain("london");
  });

  it("is deterministic and national without a branch", () => {
    const national = { ...pages[1]!, branch: null };
    expect(summarize(national)).toBe(summarize(national));
    expect(summarize(national)).toMatch(/^The Dialogue Society /);
  });

  it("stays within the limits for long venue names", () => {
    const long = {
      ...pages[0]!,
      venue: "St. Mary's Church Hall and Community Centre of the Parish",
    };
    const text = summarize(long);
    expect(text.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(sentenceCount(text)).toBeLessThanOrEqual(2);
  });
});

describe("youtube feed", () => {
  it("returns the latest 6 videos newest first", () => {
    const videos = parseChannelFeed(fixture("youtube.xml"));
    expect(videos).toHaveLength(6);
    expect(videos[0]).toMatchObject({
      id: "EPVbQMKQ2vs",
      title: "Dialogue Society North East receives The King's Award for Voluntary Service",
    });
    expect(videos.map((v) => v.id)).toEqual([
      "EPVbQMKQ2vs",
      "Zz9SmKKNJ-4",
      "HgbvEc9v4jM",
      "P9tlV1rarc0",
      "ir-AiR5jyko",
      "l9SKOqX5fY4",
    ]);
    for (const v of videos) expect(v.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(posterUrl("EPVbQMKQ2vs")).toBe("https://i.ytimg.com/vi/EPVbQMKQ2vs/hqdefault.jpg");
  });

  it("ignores entries without a valid id", () => {
    const xml =
      "<feed><entry><yt:videoId>bad</yt:videoId><title>x</title></entry>" +
      "<entry><yt:videoId>AAAAAAAAAAA</yt:videoId><title>A &amp; B</title><published>2026-01-01T00:00:00+00:00</published></entry></feed>";
    expect(parseChannelFeed(xml)).toEqual([
      { id: "AAAAAAAAAAA", title: "A & B", published: "2026-01-01T00:00:00+00:00" },
    ]);
  });
});

describe("branch mapping", () => {
  const branches = [
    { id: "b1", name: "Manchester", region_id: "r1" },
    { id: "b2", name: "North East", region_id: "r1" },
    { id: "b3", name: "London", region_id: "r2" },
  ];

  it("matches by name, case-insensitively", () => {
    expect(mapBranch(["manchester"], branches)?.id).toBe("b1");
    expect(mapBranch([" North  East "], branches)?.id).toBe("b2");
  });

  it("uses the first badge that matches and returns null (national) otherwise", () => {
    expect(mapBranch(["Greater London", "London"], branches)?.id).toBe("b3");
    expect(mapBranch(["Greater London"], branches)).toBeNull();
    expect(mapBranch([], branches)).toBeNull();
  });

  it("a region badge (e.g. Greater London) becomes a region record; a branch match wins; else national", () => {
    const regions = [
      { id: "r1", name: "North of England" },
      { id: "r2", name: "Greater London" },
    ];
    expect(mapScope(["greater  london"], branches, regions)).toEqual({
      scope: "region",
      branch: null,
      region: { id: "r2", name: "Greater London" },
    });
    expect(mapScope(["Greater London", "London"], branches, regions)).toMatchObject({
      scope: "branch",
      branch: { id: "b3" },
    });
    expect(mapScope(["Atlantis"], branches, regions)).toEqual({
      scope: "national",
      branch: null,
      region: null,
    });
  });
});

describe("title fixes", () => {
  it("fixes known source typos and leaves other titles alone", () => {
    expect(
      cleanTitle("The Role of Religion in National Government: A Case Studdy of Iran as a Starter"),
    ).toBe("The Role of Religion in National Government: A Case Study of Iran as a Starter");
    expect(cleanTitle("Life of a Chickpea")).toBe("Life of a Chickpea");
    expect(cleanTitle("x".repeat(250))).toHaveLength(200);
  });
});

describe("children and youth events", () => {
  it("school and youth events are recognised from the title (their photos stay out of the gallery)", () => {
    for (const title of [
      "“See It, Own It, Change It” by Chris Hewer – Dialogue Society Sheffield Youth Session",
      "Interfaith Dialogue at Elsecar Holy Trinity CofE Primary Academy",
      "Life of a Chickpea at Wellfield Middle School",
      "Life of a Chickpea Inspires 80 Students at St. Oswald’s Catholic Primary School",
    ])
      expect(isChildrenEvent(title)).toBe(true);
    for (const title of [
      "Bolton Celebrates Diversity and Togetherness at Interfaith Reception",
      "Multi-Faith Celebration: The Life of a Chickpea",
      "Emergency Services & Family Fun Day in Cardiff",
      "Dialogue Society Took Part in the 1st Didcot Festival of Cultures",
    ])
      expect(isChildrenEvent(title)).toBe(false);
  });
});
