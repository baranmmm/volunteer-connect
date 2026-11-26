import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { FolderInput, ImageIcon, Trash2 } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { ChapterView } from "@/components/media/ChapterView";
import {
  DeletePhotosDialog,
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
  useMediaHome,
  useMediaPhotos,
  useMediaRefresh,
  type MediaFilters,
} from "@/components/media/use-media";
import {
  getMediaChapter,
  getMediaPhotos,
  markMediaChapterViewed,
  setMediaAlbumCover,
} from "@/lib/media.functions";
import type { ChapterKind, MediaChapter, MediaPhoto, MediaTarget } from "@/lib/media";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type MediaSearch = {
  branch?: string | undefined;
  album?: string | undefined;
  event?: string | undefined;
};

export const Route = createFileRoute("/_app/media")({
  ssr: false,
  // ?album= / ?event= open a chapter (notice links use them); ?branch= is the Regional Director's branch choice.
  validateSearch: (s: Record<string, unknown>): MediaSearch => {
    const pick = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : undefined);
    return { branch: pick(s["branch"]), album: pick(s["album"]), event: pick(s["event"]) };
  },
  head: () => pageHead("Media", "Your branch's photos from events and albums (members only)."),
  component: MediaPage,
});

type LightboxState = { photos: ViewerPhoto[]; index: number; chapter: MediaChapter | null };
type SlideshowState = { photos: ViewerPhoto[]; start: number };
type Dialog =
  | { kind: "upload"; initial: { kind: ChapterKind; id: string } | null }
  | { kind: "new-album" }
  | { kind: "move"; photo: ViewerPhoto; chapter: MediaChapter }
  | { kind: "delete"; photo: ViewerPhoto; chapter: MediaChapter }
  | null;

const withCaption = (
  chapter: Pick<MediaChapter, "title" | "date" | "venue">,
  photos: MediaPhoto[],
): ViewerPhoto[] =>
  photos.map((p) => ({
    ...p,
    caption: { title: chapter.title, date: chapter.date, venue: chapter.venue },
  }));

function MediaPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const desktop = useMediaDesktop();
  const qc = useQueryClient();
  const refresh = useMediaRefresh();
  const fetchChapter = useServerFn(getMediaChapter),
    fetchPhotos = useServerFn(getMediaPhotos),
    markViewed = useServerFn(markMediaChapterViewed),
    setCover = useServerFn(setMediaAlbumCover);
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
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [slideshow, setSlideshow] = useState<SlideshowState | null>(null);
  const [story, setStory] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const chapterList = useMemo(() => chapters.data?.pages.flat() ?? [], [chapters.data]);
  const gridPhotos = useMemo(() => grid.data?.pages.flat() ?? [], [grid.data]);

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
    void navigate({ search: { branch: search.branch, [c.kind]: c.id } });
  const closeChapter = () => void navigate({ search: { branch: search.branch } });
  const afterMove = (target: MediaTarget) =>
    void navigate({
      search: {
        branch: search.branch,
        ...("album_id" in target ? { album: target.album_id } : { event: target.event_id }),
      },
    });

  const loadChapter = (c: Pick<MediaChapter, "kind" | "id">) =>
    qc.fetchQuery({
      queryKey: [MEDIA_KEY, "chapter", c.kind, c.id],
      queryFn: () => fetchChapter({ data: { kind: c.kind, id: c.id } }),
      staleTime: 4 * 60_000,
    });
  const openPhoto = async (c: Pick<MediaChapter, "kind" | "id">, photoId: string) => {
    try {
      const full = await loadChapter(c);
      if (!full) return;
      const photos = withCaption(full, full.photos);
      setLightbox({
        photos,
        index: Math.max(
          0,
          photos.findIndex((p) => p.id === photoId),
        ),
        chapter: full,
      });
      viewed(full);
    } catch (e) {
      toast.error(translateError(e));
    }
  };
  const playGallery = async () => {
    if (!branchId) return;
    try {
      // The newest photos of the branch (events and albums), each captioned with its chapter.
      const photos = await fetchPhotos({
        data: { branchId, source: debounced.source, year: debounced.year },
      });
      const list = photos.map((p) => ({
        ...p,
        caption: { title: p.chapter_title ?? "", date: p.chapter_date ?? null },
      }));
      if (list.length) setSlideshow({ photos: list, start: 0 });
    } catch (e) {
      toast.error(translateError(e));
    }
  };

  const canManage = !!home.data?.can_manage;
  const canAdd = canManage || !!home.data?.can_request;
  const lightboxActions = (photo: ViewerPhoto) => {
    const c = lightbox?.chapter;
    if (!canManage || !c) return null;
    return (
      <>
        {c.kind === "album" && photo.source === "library" && photo.id !== c.cover_photo_id && (
          <LightboxAction
            testId="media-lightbox-cover"
            icon={<ImageIcon className="size-4" aria-hidden />}
            onClick={() =>
              void setCover({ data: { albumId: c.id, photoId: photo.id } })
                .then(async () => {
                  await refresh();
                  setLightbox((l) =>
                    l && l.chapter
                      ? { ...l, chapter: { ...l.chapter, cover_photo_id: photo.id } }
                      : l,
                  );
                  toast.success(t("media.coverSet"));
                })
                .catch((e) => toast.error(translateError(e)))
            }
          >
            {t("media.setCover")}
          </LightboxAction>
        )}
        <LightboxAction
          testId="media-lightbox-move"
          icon={<FolderInput className="size-4" aria-hidden />}
          onClick={() => setDialog({ kind: "move", photo, chapter: c })}
        >
          {t("media.moveTo")}
        </LightboxAction>
        {photo.source === "library" && (
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
            onOpenPhoto={(i) =>
              setLightbox({
                photos: withCaption(chapter.data!, chapter.data!.photos),
                index: i,
                chapter: chapter.data!,
              })
            }
            onSlideshow={() =>
              setSlideshow({ photos: withCaption(chapter.data!, chapter.data!.photos), start: 0 })
            }
            onAdd={
              canAdd
                ? () =>
                    setDialog({
                      kind: "upload",
                      initial: { kind: chapter.data!.kind, id: chapter.data!.id },
                    })
                : null
            }
            onMoved={afterMove}
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
          onOpenPhoto={(c, id) => void openPhoto(c, id)}
          onOpenChapter={openChapter}
          onSlideshow={() => void playGallery()}
          onAdd={canAdd ? () => setDialog({ kind: "upload", initial: null }) : null}
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
          onOpenStory={setStory}
          onOpenGridPhoto={(i) =>
            setLightbox({
              photos: gridPhotos.map((p) => ({
                ...p,
                caption: { title: p.chapter_title ?? "", date: p.chapter_date ?? null },
              })),
              index: i,
              chapter: null,
            })
          }
          onSlideshow={() => void playGallery()}
          onAdd={canAdd ? () => setDialog({ kind: "upload", initial: null }) : null}
          onNewAlbum={canManage ? () => setDialog({ kind: "new-album" }) : null}
          loading={grid.isLoading}
        />
      )}

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onIndex={(i) => setLightbox({ ...lightbox, index: i })}
          onClose={() => setLightbox(null)}
          actions={canManage ? lightboxActions : undefined}
        />
      )}
      {story !== null && (
        <StoryViewer
          chapters={chapterList.filter((c) => c.photo_count > 0)}
          start={story}
          onClose={() => setStory(null)}
          onViewed={viewed}
        />
      )}
      {slideshow && (
        <Slideshow
          photos={slideshow.photos}
          start={slideshow.start}
          branchName={data.branch.name}
          onClose={() => setSlideshow(null)}
        />
      )}
      {dialog?.kind === "upload" && (
        <UploadDialog
          branchId={data.branch.id}
          mode={canManage ? "direct" : "request"}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onDone={(target) => {
            setDialog(null);
            if (target) afterMove(target);
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
            setLightbox(null);
            afterMove(target);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeletePhotosDialog
          ids={[dialog.photo.id]}
          chapterTitle={dialog.chapter.title}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setLightbox(null);
          }}
        />
      )}
    </div>
  );
}
