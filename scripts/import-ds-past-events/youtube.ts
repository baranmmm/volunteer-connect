// The Dialogue Society YouTube channel's public Atom feed (latest 15 uploads). Links only: the import stores the video
// id, the title and a poster image; nothing is embedded.
import { decodeEntities } from "./parse";

export const CHANNEL_ID = "UC4flSkjv9m4IvU3jwsi0ecw";
export const CHANNEL_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

export type FeedVideo = { id: string; title: string; published: string | null };

function tag(entry: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`);
  const m = re.exec(entry);
  if (!m) return null;
  return decodeEntities((m[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/\s+/g, " ")
    .trim();
}

/** Parses the channel feed → the newest `max` videos (newest first by `published`). */
export function parseChannelFeed(xml: string, max = 6): FeedVideo[] {
  const videos: FeedVideo[] = [];
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1] ?? "";
    const id = tag(entry, "yt:videoId");
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id) || videos.some((v) => v.id === id)) continue;
    const title = (tag(entry, "title") ?? "").slice(0, 300);
    const published = tag(entry, "published");
    videos.push({
      id,
      title,
      published: published && !Number.isNaN(Date.parse(published)) ? published : null,
    });
  }
  videos.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  return videos.slice(0, max);
}

export function posterUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
