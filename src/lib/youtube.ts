/** Most YouTube videos an event (or past-event record) may show. */
export const MAX_EVENT_VIDEOS = 6;
const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The 11-character video id of a pasted YouTube link: youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>,
 * /embed/<id>, /live/<id> (www., m. and music. hosts, youtube-nocookie.com). Anything else is null.
 */
export function youtubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  return id && ID.test(id) ? id : null;
}
