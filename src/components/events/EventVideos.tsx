import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { PlayCircle, Plus, Trash2 } from "lucide-react";
import { addEventVideo, listEventVideos, removeEventVideo } from "@/lib/event-videos.functions";
import { MAX_EVENT_VIDEOS, youtubeId } from "@/lib/youtube";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * YouTube videos of a public event: everyone who can see the event gets the list (posters stored by the server);
 * managers also add links and remove videos.
 */
export function EventVideos({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listEventVideos),
    addFn = useServerFn(addEventVideo),
    removeFn = useServerFn(removeEventVideo);
  const key = ["event-videos", eventId];
  const videos = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { eventId } }),
    staleTime: 240000,
  });
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const list = videos.data ?? [];
  if (!canManage && !list.length) return null;
  async function add() {
    if (busy) return;
    setError("");
    if (!youtubeId(url)) {
      setError(t("pastEvents.invalidYoutube"));
      return;
    }
    setBusy(true);
    try {
      await addFn({ data: { eventId, url } });
      setUrl("");
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await removeFn({ data: { id } });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section data-testid="event-videos" aria-labelledby="event-videos-title" className="space-y-3">
      <h2 id="event-videos-title" className="text-lg font-semibold">
        {t("pastEvents.videos")}
      </h2>
      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((v) => (
            <li
              key={v.id}
              data-testid="event-video"
              data-video-id={v.id}
              data-youtube-id={v.youtube_id}
              className="space-y-2 rounded-lg border bg-card p-2"
            >
              <a
                href={`https://www.youtube.com/watch?v=${v.youtube_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block overflow-hidden rounded-md bg-muted"
              >
                {v.thumb_url ? (
                  <img src={v.thumb_url} alt="" className="aspect-video w-full object-cover" />
                ) : (
                  <span className="flex aspect-video w-full items-center justify-center" />
                )}
                <PlayCircle
                  className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 text-background drop-shadow"
                  aria-hidden
                />
                <span className="sr-only">
                  {t("pastEvents.watchVideo", { title: v.title || v.youtube_id })}
                </span>
              </a>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 break-words text-sm">{v.title || v.youtube_id}</p>
                {canManage && (
                  <Button
                    data-testid="event-video-remove"
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t("events.remove")}
                    title={t("events.remove")}
                    onClick={() => void remove(v.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && list.length < MAX_EVENT_VIDEOS && (
        <div className="space-y-1.5">
          <Label htmlFor={`event-video-url-${eventId}`}>{t("pastEvents.youtubeLink")}</Label>
          <div className="flex gap-2">
            <Input
              id={`event-video-url-${eventId}`}
              data-testid="event-video-url"
              type="url"
              inputMode="url"
              value={url}
              placeholder="https://youtu.be/…"
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              className="h-11 min-w-0"
            />
            <Button
              data-testid="event-video-add"
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy || !url.trim()}
              onClick={() => void add()}
            >
              <Plus />
              {t("pastEvents.addVideo")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("pastEvents.youtubeHint")}</p>
        </div>
      )}
      {error && (
        <p data-testid="event-video-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
