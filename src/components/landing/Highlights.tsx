import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import type { LandingHighlight } from "@/lib/landing.server";
import { Reveal } from "./Reveal";

/**
 * Videos chosen by managers. Nothing from YouTube or Google loads before a click: the poster is our own signed image
 * (or a branded placeholder) and only the click swaps in the privacy-enhanced youtube-nocookie player.
 */
function Video({ video }: { video: LandingHighlight }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const title = video.title || t("landing.highlights.untitled");
  return (
    <li className="overflow-hidden rounded-[5px] bg-ds-surface shadow-ds-card">
      <div className="relative aspect-video bg-[#171B21]">
        {playing ? (
          <iframe
            ref={(node) => node?.focus()}
            data-testid="landing-highlight-iframe"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtube_id)}?autoplay=1&rel=0`}
            title={t("landing.highlights.iframeTitle", { title })}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            data-testid="landing-highlight-play"
            data-video-id={video.youtube_id}
            onClick={() => setPlaying(true)}
            aria-label={t("landing.highlights.play", { title })}
            className="group absolute inset-0 flex h-full w-full items-center justify-center focus-visible:outline-offset-[-4px]"
          >
            {video.poster ? (
              <img
                src={video.poster}
                alt=""
                width={480}
                height={270}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="absolute inset-0 flex items-end bg-[linear-gradient(135deg,#006D9C,#28303D)] p-4 text-left text-lg font-semibold text-white"
              >
                <span className="line-clamp-2">{title}</span>
              </span>
            )}
            <span
              aria-hidden
              className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-[#28303D] shadow-lg transition-transform group-hover:scale-110 motion-reduce:transition-none"
            >
              <Play className="ml-1 h-7 w-7 fill-current" />
            </span>
          </button>
        )}
      </div>
      <p className="p-4 font-semibold leading-snug break-words">{title}</p>
    </li>
  );
}

export function Highlights({ videos }: { videos: LandingHighlight[] }) {
  const { t } = useTranslation();
  if (!videos.length) return null;
  return (
    <Reveal
      data-testid="landing-highlights"
      aria-labelledby="landing-highlights-title"
      className="bg-ds-alt"
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 id="landing-highlights-title" className="text-3xl font-bold sm:text-4xl">
          {t("landing.highlights.title")}
        </h2>
        <p className="mt-2 max-w-xl text-ds-muted">{t("landing.highlights.intro")}</p>
        <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <Video key={v.id} video={v} />
          ))}
        </ul>
        <p className="mt-6 text-sm text-ds-muted">{t("landing.highlights.privacy")}</p>
      </div>
    </Reveal>
  );
}
