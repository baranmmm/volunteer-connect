import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  FolderInput,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { reorderMediaPhotos } from "@/lib/media.functions";
import {
  MASONRY_GAP,
  MASONRY_ROW,
  masonryColumns,
  masonrySpan,
  type MediaChapter,
  type MediaItemRef,
  type MediaPhoto,
  type MediaTarget,
} from "@/lib/media";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { chapterDate, MediaThumb, photoAlt, useChapterMeta } from "./MediaParts";
import { AlbumDialog, DeleteAlbumDialog, DeletePhotosDialog, MoveDialog } from "./MediaDialogs";
import { useMediaRefresh } from "./use-media";

/**
 * The full chapter: a masonry grid of every photo, "Play slideshow" and a back link to the timeline. Managers also
 * select photos (Move to…, Delete), edit or delete an album and arrange its photos.
 */
export function ChapterView({
  chapter,
  branchId,
  canManage,
  onBack,
  onOpenPhoto,
  onSlideshow,
  onAdd,
  onMoved,
}: {
  chapter: MediaChapter;
  branchId: string;
  canManage: boolean;
  onBack: () => void;
  onOpenPhoto: (index: number) => void;
  onSlideshow: () => void;
  onAdd: (() => void) | null;
  onMoved: (target: MediaTarget) => void;
}) {
  const { t } = useTranslation();
  const meta = useChapterMeta();
  const refresh = useMediaRefresh();
  const reorder = useServerFn(reorderMediaPhotos);
  const [selecting, setSelecting] = useState(false);
  const [arranging, setArranging] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<"move" | "delete" | "edit" | "delete-album" | null>(null);
  // The masonry's column count follows the width it really has (sidebar, page padding).
  const grid = useRef<HTMLUListElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setGridWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [chapter.photos.length]);
  const columns = masonryColumns(gridWidth);
  const columnWidth = gridWidth ? (gridWidth - MASONRY_GAP * (columns - 1)) / columns : 200;
  const photos = arranging
    ? arranging.map((id) => chapter.photos.find((p) => p.id === id)!).filter(Boolean)
    : chapter.photos;
  const items: MediaItemRef[] = selected.map((id) => ({
    id,
    source: chapter.photos.find((p) => p.id === id)?.source ?? "library",
  }));
  const deletable = items.length > 0 && items.every((i) => i.source === "library");
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
  };
  const shift = (i: number, d: -1 | 1) =>
    setArranging((list) => {
      if (!list) return list;
      const next = [...list];
      const j = i + d;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  async function saveOrder() {
    if (!arranging) return;
    try {
      // The album's cover leads the grid; the saved order is the album's own photo order.
      await reorder({ data: { albumId: chapter.id, ids: arranging } });
      await refresh();
      toast.success(t("media.orderSaved"));
      setArranging(null);
    } catch (e) {
      toast.error(translateError(e));
    }
  }
  return (
    <div
      data-testid="media-chapter-view"
      data-chapter-id={chapter.id}
      data-chapter-kind={chapter.kind}
      className="min-w-0 space-y-6"
    >
      <button
        type="button"
        data-testid="media-chapter-back"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("media.backToTimeline")}
      </button>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {chapter.date && (
            <p className="text-sm font-bold text-primary">{chapterDate(chapter.date)}</p>
          )}
          <h1
            data-testid="media-chapter-title"
            className="text-[1.75rem] font-semibold leading-tight sm:text-[2.25rem]"
          >
            {chapter.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{meta(chapter)}</p>
          {chapter.description && <p className="mt-2 max-w-2xl text-sm">{chapter.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="media-chapter-play"
            className="h-11 rounded-full px-5"
            disabled={!chapter.photos.length}
            onClick={onSlideshow}
          >
            <Play className="size-4" aria-hidden />
            {t("media.playSlideshow")}
          </Button>
          {onAdd && (
            <Button
              data-testid="media-chapter-add"
              variant="outline"
              className="h-11 rounded-full bg-card px-5"
              onClick={onAdd}
            >
              <Plus className="size-4" aria-hidden />
              {canManage ? t("media.addPhotos") : t("media.requestUpload")}
            </Button>
          )}
        </div>
      </header>

      {canManage && (
        <div
          data-testid="media-chapter-tools"
          className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2"
        >
          {arranging ? (
            <>
              <p className="px-2 text-sm">{t("media.arrangeHint")}</p>
              <span className="flex-1" />
              <Button variant="outline" className="h-11" onClick={() => setArranging(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="media-arrange-save"
                className="h-11"
                onClick={() => void saveOrder()}
              >
                {t("media.saveOrder")}
              </Button>
            </>
          ) : selecting ? (
            <>
              <p
                data-testid="media-selected-count"
                className="px-2 text-sm font-medium"
                aria-live="polite"
              >
                {t("media.selected", { count: selected.length })}
              </p>
              <span className="flex-1" />
              <Button
                data-testid="media-move-selected"
                variant="outline"
                className="h-11"
                disabled={!selected.length}
                onClick={() => setDialog("move")}
              >
                <FolderInput className="size-4" aria-hidden />
                {t("media.moveTo")}
              </Button>
              <Button
                data-testid="media-delete-selected"
                variant="outline"
                className="h-11 text-destructive"
                disabled={!deletable}
                title={!deletable && selected.length ? t("media.eventPhotosDeleteHint") : undefined}
                onClick={() => setDialog("delete")}
              >
                <Trash2 className="size-4" aria-hidden />
                {t("media.delete")}
              </Button>
              <Button variant="ghost" className="h-11" onClick={stopSelecting}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                data-testid="media-select"
                variant="ghost"
                className="h-11"
                disabled={!chapter.photos.length}
                onClick={() => setSelecting(true)}
              >
                <Check className="size-4" aria-hidden />
                {t("media.select")}
              </Button>
              {chapter.kind === "album" && (
                <>
                  <Button
                    data-testid="media-arrange"
                    variant="ghost"
                    className="h-11"
                    disabled={chapter.photos.length < 2}
                    onClick={() => setArranging(chapter.photos.map((p) => p.id))}
                  >
                    {t("media.arrange")}
                  </Button>
                  <span className="flex-1" />
                  <Button
                    data-testid="media-album-edit"
                    variant="ghost"
                    className="h-11"
                    onClick={() => setDialog("edit")}
                  >
                    <Pencil className="size-4" aria-hidden />
                    {t("media.editAlbum")}
                  </Button>
                  <Button
                    data-testid="media-album-delete"
                    variant="ghost"
                    className="h-11 text-destructive"
                    onClick={() => setDialog("delete-album")}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("media.deleteAlbum")}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {photos.length === 0 ? (
        <p
          data-testid="media-chapter-empty"
          className="rounded-2xl border border-dashed bg-card p-10 text-center text-muted-foreground"
        >
          {t("media.emptyAlbum")}
        </p>
      ) : (
        <ul
          ref={grid}
          data-testid="media-masonry"
          data-columns={columns}
          className="grid grid-flow-row-dense"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridAutoRows: `${MASONRY_ROW}px`,
            columnGap: `${MASONRY_GAP}px`,
          }}
        >
          {photos.map((p: MediaPhoto, i) => {
            const isSelected = selected.includes(p.id);
            const alt = photoAlt(t, chapter.title, i, photos.length);
            const ratio = p.width && p.height ? `${p.width} / ${p.height}` : "4 / 3";
            return (
              <li
                key={p.id}
                className="relative"
                style={{ gridRowEnd: `span ${masonrySpan(columnWidth, p.width, p.height)}` }}
              >
                <button
                  type="button"
                  data-testid="media-masonry-photo"
                  data-photo-id={p.id}
                  data-source={p.source}
                  aria-pressed={selecting ? isSelected : undefined}
                  aria-label={
                    selecting
                      ? t(isSelected ? "media.deselectPhoto" : "media.selectPhoto", { n: i + 1 })
                      : alt
                  }
                  disabled={!!arranging}
                  onClick={() => (selecting ? toggle(p.id) : onOpenPhoto(i))}
                  style={{ aspectRatio: ratio }}
                  className={cn(
                    "block w-full overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected && "ring-4 ring-primary ring-offset-2",
                  )}
                >
                  <MediaThumb photo={p} alt="" eager={i < 8} />
                  {selecting && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border-2 border-white shadow",
                        isSelected ? "bg-primary text-primary-foreground" : "bg-black/30",
                      )}
                    >
                      {isSelected && <Check className="size-4" />}
                    </span>
                  )}
                  {p.id === chapter.cover_photo_id && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
                      {t("media.cover")}
                    </span>
                  )}
                </button>
                {arranging && (
                  <span className="absolute inset-x-2 bottom-2 flex justify-between">
                    <Button
                      size="icon"
                      variant="secondary"
                      className="size-11 rounded-full"
                      aria-label={t("media.moveEarlier", { n: i + 1 })}
                      disabled={i === 0}
                      onClick={() => shift(i, -1)}
                    >
                      <ArrowLeft className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="size-11 rounded-full"
                      aria-label={t("media.moveLater", { n: i + 1 })}
                      disabled={i === photos.length - 1}
                      onClick={() => shift(i, 1)}
                    >
                      <ArrowRight className="size-4" aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog === "move" && (
        <MoveDialog
          branchId={branchId}
          items={items}
          current={chapter}
          onClose={() => setDialog(null)}
          onMoved={(target) => {
            setDialog(null);
            stopSelecting();
            onMoved(target);
          }}
        />
      )}
      {dialog === "delete" && (
        <DeletePhotosDialog
          ids={selected}
          chapterTitle={chapter.title}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            stopSelecting();
          }}
        />
      )}
      {dialog === "edit" && (
        <AlbumDialog
          branchId={branchId}
          album={{
            id: chapter.id,
            title: chapter.title,
            date: chapter.date,
            description: chapter.description,
          }}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}
      {dialog === "delete-album" && (
        <DeleteAlbumDialog
          album={chapter}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            onBack();
          }}
        />
      )}
    </div>
  );
}
