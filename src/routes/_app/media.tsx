import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Download, FolderInput, ImageIcon, Star, Trash2 } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { ChapterView } from "@/components/media/ChapterView";
import {
  DeletePhotosDialog,
  DownloadRequestDialog,
  MoveDialog,
  UploadDialog,
  AlbumDialog,
} from "@/components/media/MediaDialogs";
import { MediaStories } from "@/components/media/MediaStories";
import { MediaTimeline } from "@/components/media/MediaTimeline";
import {
  Lightbox,
  LightboxAction,
  Slideshow,
  StoryViewer,
  type ViewerPhoto,
} from "@/components/media/MediaViewers";
import {
  MEDIA_KEY,
  useMediaChapter,
  useMediaChapters,
  useMediaDesktop,
  useMediaHighlights,
  useMediaHome,
  useMediaPhotos,
  useMediaRefresh,
  type MediaFilters,
} from "@/components/media/use-media";
import {
  getMediaOriginalUrl,
  getMediaPhotos,
  markMediaChapterViewed,
  setMediaAlbumCover,
  setMediaHighlight,
} from "@/lib/media.functions";
import {
  chapterRef,
  parseChapterRef,
  type ChapterKind,
  type MediaChapter,
  type MediaHighlight,
  type MediaItemRef,
  type MediaPhoto,
  type MediaTarget,
} from "@/lib/media";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything open on the Media screen lives in the URL, so the phone's Back button closes it and a shared or reloaded
 * link opens the same view (for members who can see it):
 *   album / event  the full chapter view (notice links use these)
 *   story          the story viewer: "album:<id>" | "event:<id>"
 *   photo, pc, lb  the lightbox: the photo, its chapter ("album:<id>"), and "grid" / "highlights" when it browses the
 *                  phone grid or the highlights
 *   slideshow      "highlights" | "gallery" (the branch's newest photos) | "album:<id>" | "event:<id>"
 *   menu           "1": the ⋯ menu on phones
 *   request        "event:<id>" | "album:<id>": opens the upload (request) form for it (the post-event nudge's link)
 *   branch         the Regional Director's branch choice
 */
type MediaSearch = {
  branch?: string | undefined;
  album?: string | undefined;
  event?: string | undefined;
  story?: string | undefined;
  photo?: string | undefined;
  pc?: string | undefined;
  lb?: "grid" | "highlights" | undefined;
  slideshow?: string | undefined;
  menu?: "1" | undefined;
  request?: string | undefined;
};
const OVERLAY_KEYS = ["story", "photo", "pc", "lb", "slideshow", "menu"] as const;

export const Route = createFileRoute("/_app/media")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): MediaSearch => {
    const pick = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : undefined);
    const ref = (v: unknown) => (typeof v === "string" && parseChapterRef(v) ? v : undefined);
    return {
      branch: pick(s["branch"]),
      album: pick(s["album"]),
      event: pick(s["event"]),
      story: ref(s["story"]),
      photo: pick(s["photo"]),
      pc: ref(s["pc"]),
      lb: s["lb"] === "grid" || s["lb"] === "highlights" ? s["lb"] : undefined,
      slideshow:
        s["slideshow"] === "gallery" || s["slideshow"] === "highlights"
          ? s["slideshow"]
          : ref(s["slideshow"]),
      menu: s["menu"] === "1" || s["menu"] === 1 ? "1" : undefined,
      request: ref(s["request"]),
    };
  },
  head: () => pageHead("Media", "Your branch's photos from events and albums (members only)."),
  component: MediaPage,
});

type Dialog =
  | { kind: "upload"; initial: { kind: ChapterKind; id: string } | null }
  | { kind: "new-album" }
  | { kind: "move"; photo: ViewerPhoto; chapter: MediaChapter }
  | { kind: "delete"; photo: ViewerPhoto; chapter: MediaChapter }
  | { kind: "download"; items: MediaItemRef[] }
  | null;

const withCaption = (
  chapter: Pick<MediaChapter, "title" | "date" | "venue">,
  photos: MediaPhoto[],
): ViewerPhoto[] =>
  photos.map((p) => ({
    ...p,
    caption: { title: chapter.title, date: chapter.date, venue: chapter.venue },
  }));
const highlightCaption = (photos: MediaHighlight[]): ViewerPhoto[] =>
  photos.map((p) => ({
    ...p,
    caption: {
      title: p.chapter_title ?? "",
      date: p.chapter_date ?? null,
      venue: p.chapter_venue ?? null,
    },
  }));
const gridCaption = (photos: MediaPhoto[]): ViewerPhoto[] =>
  photos.map((p) => ({
    ...p,
    caption: { title: p.chapter_title ?? "", date: p.chapter_date ?? null },
  }));

/** History entries the Media screen pushed for an open view carry this flag, so closing can go back instead. */
type OverlayState = { mediaOverlay?: boolean };

function MediaPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const desktop = useMediaDesktop();
  const qc = useQueryClient();
  const refresh = useMediaRefresh();
  const fetchPhotos = useServerFn(getMediaPhotos),
    markViewed = useServerFn(markMediaChapterViewed),
    setCover = useServerFn(setMediaAlbumCover),
    setStar = useServerFn(setMediaHighlight),
    originalUrl = useServerFn(getMediaOriginalUrl);
  const home = useMediaHome(search.branch ?? null);
  const branchId = home.data?.branch.id;
  const [filters, setFilters] = useState<MediaFilters>({ source: "all", year: null, search: "" });
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(filters), 250);
    return () => window.clearTimeout(id);
  }, [filters]);
  const chapters = useMediaChapters(branchId, debounced);
  const grid = useMediaPhotos(desktop === false ? branchId : undefined, {
    source: debounced.source,
    year: debounced.year,
  });
  const openKind: ChapterKind | null = search.album ? "album" : search.event ? "event" : null;
  const openId = search.album ?? search.event ?? null;
  const chapter = useMediaChapter(openKind, openId);
  const [dialog, setDialog] = useState<Dialog>(null);

  const chapterList = useMemo(() => chapters.data?.pages.flat() ?? [], [chapters.data]);
  const storyChapters = useMemo(() => chapterList.filter((c) => c.photo_count > 0), [chapterList]);
  const gridPhotos = useMemo(() => grid.data?.pages.flat() ?? [], [grid.data]);
  const highlights = useMediaHighlights(branchId);
  const highlightPhotos = useMemo(() => highlights.data ?? [], [highlights.data]);

  // ---- History: opening pushes an entry (flagged); moving inside a viewer replaces it; closing goes back. ----
  const open = (patch: Partial<MediaSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      resetScroll: false,
      state: (s) => ({ ...s, mediaOverlay: true }),
    });
  const replace = (patch: Partial<MediaSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
      state: (s) => s,
    });
  const close = (keys: readonly (keyof MediaSearch)[]) => {
    // Opened from this screen: Back returns exactly to it (scroll, filters), and a second Back never reopens it.
    // Opened from a link or a reload: there is nothing of ours to go back to, so the view is removed in place.
    if ((router.state.location.state as OverlayState).mediaOverlay) router.history.back();
    else
      void navigate({
        search: (prev) => {
          const next = { ...prev };
          for (const k of keys) delete next[k];
          return next;
        },
        replace: true,
        resetScroll: false,
      });
  };
  const closeOverlay = () => close(OVERLAY_KEYS);

  // Opening a chapter marks it viewed (the amber story ring goes until new photos arrive).
  const viewed = useCallback(
    (c: Pick<MediaChapter, "kind" | "id">) => {
      void markViewed({ data: { kind: c.kind, id: c.id } })
        .then(() => qc.invalidateQueries({ queryKey: [MEDIA_KEY, "chapters"] }))
        .catch(() => undefined);
    },
    [markViewed, qc],
  );
  useEffect(() => {
    if (chapter.data) viewed(chapter.data);
  }, [chapter.data, viewed]);

  const openChapter = (c: Pick<MediaChapter, "kind" | "id">) =>
    void navigate({
      search: { branch: search.branch, [c.kind]: c.id },
      state: (s) => ({ ...s, mediaOverlay: true }),
    });
  const closeChapter = () => close(["album", "event", ...OVERLAY_KEYS]);
  // After a move or an upload the target chapter opens: in place of a view already open, so Back leads to the
  // timeline, or as a new entry from the timeline.
  const showTarget = (target: MediaTarget) => {
    const next = {
      branch: search.branch,
      ...("album_id" in target ? { album: target.album_id } : { event: target.event_id }),
    };
    const inView = !!openKind || !!search.photo;
    void navigate({
      search: next,
      replace: inView,
      state: (s) => ({ ...s, mediaOverlay: inView ? (s as OverlayState).mediaOverlay : true }),
    });
  };

  // ---- Lightbox (?photo=&pc=[&lb=grid|highlights]) ----
  const pcRef = search.photo && search.pc ? parseChapterRef(search.pc) : null;
  const pcChapter = useMediaChapter(pcRef?.kind ?? null, pcRef?.id ?? null);
  const gridHasPhoto = search.lb === "grid" && gridPhotos.some((p) => p.id === search.photo);
  const highlightHasPhoto =
    search.lb === "highlights" && highlightPhotos.some((p) => p.id === search.photo);
  const lightboxPhotos: ViewerPhoto[] | null = !search.photo
    ? null
    : gridHasPhoto
      ? gridCaption(gridPhotos)
      : highlightHasPhoto
        ? highlightCaption(highlightPhotos)
        : pcChapter.data
        ? withCaption(pcChapter.data, pcChapter.data.photos)
        : null;
  const lightboxIndex = lightboxPhotos?.findIndex((p) => p.id === search.photo) ?? -1;
  const openPhoto = (
    c: Pick<MediaChapter, "kind" | "id">,
    photoId: string,
    from?: "grid" | "highlights",
  ) => {
    open({ photo: photoId, pc: chapterRef(c), lb: from });
    viewed(c);
  };
  // A photo that is gone (deleted, moved, not visible) closes the lightbox instead of showing nothing.
  const lightboxMissing =
    !!search.photo &&
    !pcChapter.isLoading &&
    !(search.lb === "grid" && grid.isLoading) &&
    !(search.lb === "highlights" && highlights.isLoading) &&
    (lightboxPhotos === null || lightboxIndex < 0);
  useEffect(() => {
    if (lightboxMissing) close(["photo", "pc", "lb"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxMissing]);

  // ---- Story viewer (?story=album:<id>) ----
  const storyRef = search.story ? parseChapterRef(search.story) : null;
  const storyIndex = storyRef ? storyChapters.findIndex((c) => c.id === storyRef.id) : -1;
  // A shared or reloaded story link whose chapter is not in the row (filters, more chapters): that chapter alone.
  const storyAlone = useMediaChapter(
    storyRef && storyIndex < 0 && !chapters.isLoading ? storyRef.kind : null,
    storyRef?.id ?? null,
  );
  const storyList = storyIndex >= 0 ? storyChapters : storyAlone.data ? [storyAlone.data] : null;

  // ---- Slideshow (?slideshow=highlights | gallery | album:<id>) ----
  const slideRef =
    search.slideshow && search.slideshow !== "gallery" && search.slideshow !== "highlights"
      ? parseChapterRef(search.slideshow)
      : null;
  const slideChapter = useMediaChapter(slideRef?.kind ?? null, slideRef?.id ?? null);
  const galleryShow = useQuery({
    queryKey: [MEDIA_KEY, "slideshow", branchId, debounced.source, debounced.year],
    enabled: search.slideshow === "gallery" && !!branchId,
    // The newest photos of the branch (events and albums), each captioned with its chapter.
    queryFn: async () =>
      gridCaption(
        await fetchPhotos({
          data: { branchId: branchId!, source: debounced.source, year: debounced.year },
        }),
      ),
    staleTime: 4 * 60_000,
  });
  const slidePhotos: ViewerPhoto[] | null =
    search.slideshow === "highlights"
      ? highlights.data
        ? highlightCaption(highlights.data)
        : null
      : search.slideshow === "gallery"
      ? (galleryShow.data ?? null)
      : slideChapter.data
        ? withCaption(slideChapter.data, slideChapter.data.photos)
        : null;

  const canManage = !!home.data?.can_manage;
  const canAdd = canManage || !!home.data?.can_request;
  // The header's Slideshow plays the highlights when there are any, otherwise the newest photos.
  const playHeader = () => open({ slideshow: highlightPhotos.length ? "highlights" : "gallery" });

  // The upload (request) form for a chapter (?request=event:<id>, the post-event nudge's link): opened once, then
  // the parameter goes (the form is not part of the history).
  const requestRef = search.request ? parseChapterRef(search.request) : null;
  useEffect(() => {
    if (!requestRef || !home.data) return;
    if (canAdd) setDialog({ kind: "upload", initial: requestRef });
    replace({ request: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.request, home.data]);

  const lightboxActions = (photo: ViewerPhoto) => {
    const c = pcChapter.data;
    if (!canManage)
      // Volunteers and trustees: the full-size file only through an approved download request.
      return (
        <LightboxAction
          testId="media-lightbox-request-download"
          icon={<Download className="size-4" aria-hidden />}
          onClick={() =>
            setDialog({ kind: "download", items: [{ source: photo.source, id: photo.id }] })
          }
        >
          {t("media.downloads.request")}
        </LightboxAction>
      );
    return (
      <>
        <LightboxAction
          testId="media-lightbox-star"
          pressed={!!photo.starred}
          icon={<Star className={photo.starred ? "size-4 fill-current" : "size-4"} aria-hidden />}
          onClick={() =>
            void setStar({ data: { source: photo.source, id: photo.id, on: !photo.starred } })
              .then(async () => {
                await refresh();
                toast.success(t(photo.starred ? "media.highlights.unstarred" : "media.highlights.starred"));
              })
              .catch((e) => toast.error(translateError(e)))
          }
        >
          {t(photo.starred ? "media.highlights.unstar" : "media.highlights.star")}
        </LightboxAction>
        {c && (
          <LightboxAction
            testId="media-lightbox-download"
            icon={<Download className="size-4" aria-hidden />}
            onClick={() =>
              void originalUrl({ data: { chapterKind: c.kind, chapterId: c.id, photoId: photo.id } })
                .then(({ url }) => {
                  window.location.href = url;
                })
                .catch((e) => toast.error(translateError(e)))
            }
          >
            {t("media.downloads.download")}
          </LightboxAction>
        )}
        {c?.kind === "album" && photo.source === "library" && photo.id !== c.cover_photo_id && (
          <LightboxAction
            testId="media-lightbox-cover"
            icon={<ImageIcon className="size-4" aria-hidden />}
            onClick={() =>
              void setCover({ data: { albumId: c.id, photoId: photo.id } })
                .then(async () => {
                  await refresh();
                  toast.success(t("media.coverSet"));
                })
                .catch((e) => toast.error(translateError(e)))
            }
          >
            {t("media.setCover")}
          </LightboxAction>
        )}
        {c && (
          <LightboxAction
            testId="media-lightbox-move"
            icon={<FolderInput className="size-4" aria-hidden />}
            onClick={() => setDialog({ kind: "move", photo, chapter: c })}
          >
            {t("media.moveTo")}
          </LightboxAction>
        )}
        {c && photo.source === "library" && (
          <LightboxAction
            testId="media-lightbox-delete"
            icon={<Trash2 className="size-4" aria-hidden />}
            onClick={() => setDialog({ kind: "delete", photo, chapter: c })}
          >
            {t("media.delete")}
          </LightboxAction>
        )}
      </>
    );
  };

  if (home.isLoading || desktop === null)
    return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (home.isError)
    return (
      <p role="alert" className="text-destructive">
        {translateError(home.error)}
      </p>
    );
  if (!home.data)
    return (
      <div data-testid="media-not-member" className="space-y-2">
        <h1 className="text-3xl font-bold">{t("navigation.media")}</h1>
        <p className="text-muted-foreground">{t("media.notMember")}</p>
      </div>
    );
  const data = home.data;

  return (
    <div className="min-w-0">
      {data.branches.length > 1 && (
        <label className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("media.branch")}</span>
          <select
            data-testid="media-branch"
            value={data.branch.id}
            onChange={(e) => void navigate({ search: { branch: e.target.value } })}
            className="h-11 rounded-md border border-input bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {openKind && openId ? (
        chapter.isLoading ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : chapter.data ? (
          <ChapterView
            chapter={chapter.data}
            branchId={data.branch.id}
            canManage={canManage}
            onBack={closeChapter}
            onOpenPhoto={(i) => openPhoto(chapter.data!, chapter.data!.photos[i]!.id)}
            onSlideshow={() => open({ slideshow: chapterRef(chapter.data!) })}
            onAdd={
              canAdd
                ? () =>
                    setDialog({
                      kind: "upload",
                      initial: { kind: chapter.data!.kind, id: chapter.data!.id },
                    })
                : null
            }
            onMoved={showTarget}
            onRequestDownload={
              canManage ? null : (items) => setDialog({ kind: "download", items })
            }
          />
        ) : (
          <div data-testid="media-chapter-missing" className="space-y-3">
            <p className="text-muted-foreground">{t("media.chapterMissing")}</p>
            <button
              type="button"
              className="min-h-11 text-primary underline"
              onClick={closeChapter}
            >
              {t("media.backToTimeline")}
            </button>
          </div>
        )
      ) : desktop ? (
        <MediaTimeline
          home={data}
          chapters={chapterList}
          filters={filters}
          onFilters={setFilters}
          hasMore={!!chapters.hasNextPage}
          loadingMore={chapters.isFetchingNextPage}
          onLoadMore={() => void chapters.fetchNextPage()}
          onOpenPhoto={(c, id) => openPhoto(c, id)}
          onOpenChapter={openChapter}
          onSlideshow={playHeader}
          onAdd={canAdd ? () => setDialog({ kind: "upload", initial: null }) : null}
          highlights={highlightPhotos}
          onOpenHighlight={(i) => {
            const p = highlightPhotos[i];
            if (p?.chapter_kind && p.chapter_id)
              openPhoto({ kind: p.chapter_kind, id: p.chapter_id }, p.id, "highlights");
          }}
          onPlayHighlights={() => open({ slideshow: "highlights" })}
          loading={chapters.isLoading}
        />
      ) : (
        <MediaStories
          home={data}
          chapters={chapterList}
          photos={gridPhotos}
          filters={filters}
          onFilters={setFilters}
          hasMore={!!grid.hasNextPage}
          loadingMore={grid.isFetchingNextPage}
          onLoadMore={() => void grid.fetchNextPage()}
          onOpenStory={(i) => storyChapters[i] && open({ story: chapterRef(storyChapters[i]!) })}
          onOpenGridPhoto={(i) => {
            const p = gridPhotos[i];
            if (p?.chapter_kind && p.chapter_id)
              openPhoto({ kind: p.chapter_kind, id: p.chapter_id }, p.id, "grid");
          }}
          onSlideshow={playHeader}
          onAdd={canAdd ? () => setDialog({ kind: "upload", initial: null }) : null}
          highlights={highlightPhotos}
          onOpenHighlight={(i) => {
            const p = highlightPhotos[i];
            if (p?.chapter_kind && p.chapter_id)
              openPhoto({ kind: p.chapter_kind, id: p.chapter_id }, p.id, "highlights");
          }}
          onNewAlbum={canManage ? () => setDialog({ kind: "new-album" }) : null}
          menuOpen={search.menu === "1"}
          onMenuOpenChange={(v) => (v ? open({ menu: "1" }) : search.menu && close(["menu"]))}
          loading={grid.isLoading}
        />
      )}

      {lightboxPhotos && lightboxIndex >= 0 && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          onIndex={(i) => {
            const p = lightboxPhotos[i];
            if (!p) return;
            // The next photo replaces this entry (one Back always closes the lightbox); in the grid the photo's
            // chapter changes with it (actions and a reload use it).
            replace({
              photo: p.id,
              ...((gridHasPhoto || highlightHasPhoto) && p.chapter_kind && p.chapter_id
                ? { pc: chapterRef({ kind: p.chapter_kind, id: p.chapter_id }) }
                : {}),
            });
          }}
          onClose={closeOverlay}
          actions={lightboxActions}
        />
      )}
      {storyList && storyRef && (
        <StoryViewer
          chapters={storyList}
          index={Math.max(
            0,
            storyList.findIndex((c) => c.id === storyRef.id),
          )}
          onIndex={(i) => storyList[i] && replace({ story: chapterRef(storyList[i]!) })}
          onClose={closeOverlay}
          onViewed={viewed}
        />
      )}
      {slidePhotos && slidePhotos.length > 0 && (
        <Slideshow photos={slidePhotos} branchName={data.branch.name} onClose={closeOverlay} />
      )}
      {dialog?.kind === "upload" && (
        <UploadDialog
          branchId={data.branch.id}
          mode={canManage ? "direct" : "request"}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onDone={(target) => {
            setDialog(null);
            if (target) showTarget(target);
          }}
        />
      )}
      {dialog?.kind === "new-album" && (
        <AlbumDialog
          branchId={data.branch.id}
          album={null}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            openChapter({ kind: "album", id });
          }}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          branchId={data.branch.id}
          items={[{ source: dialog.photo.source, id: dialog.photo.id }]}
          current={dialog.chapter}
          onClose={() => setDialog(null)}
          onMoved={(target) => {
            setDialog(null);
            showTarget(target);
          }}
        />
      )}
      {dialog?.kind === "download" && (
        <DownloadRequestDialog
          items={dialog.items}
          onClose={() => setDialog(null)}
          onSent={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeletePhotosDialog
          ids={[dialog.photo.id]}
          chapterTitle={dialog.chapter.title}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            closeOverlay();
          }}
        />
      )}
    </div>
  );
}
