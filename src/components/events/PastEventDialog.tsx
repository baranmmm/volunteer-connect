import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Image, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { eventFileExtension, type EventMedia, type HubEvent } from "@/lib/event-rules";
import {
  prepareEventFile,
  preparedImageSize,
  removeStoredEventFile,
  uploadEventFile,
} from "@/lib/event-files";
import {
  deleteEventMedia,
  eventBranches,
  reorderEventMedia,
  reserveEventMedia,
  setEventMediaGallery,
  setEventMediaSize,
} from "@/lib/events.functions";
import { createPastEvent, updatePastEvent } from "@/lib/past-events.functions";
import { addEventVideo } from "@/lib/event-videos.functions";
import { londonToday, MAX_PAST_EVENT_PHOTOS, validatePastEvent } from "@/lib/past-events";
import { MAX_EVENT_VIDEOS, youtubeId } from "@/lib/youtube";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventDialog } from "./EventDialog";
import { EventVideos } from "./EventVideos";

type Photo = {
  key: string;
  name: string;
  file?: File;
  media?: EventMedia;
  preview?: string;
  inGallery: boolean;
};

/**
 * Add (or edit) a past event: a public record of an event that already took place, with photos (each can be shown in
 * the public gallery; on by default) and optional YouTube videos. Branch managers record their own branch, regional
 * directors a branch of their region, National Coordinators national records. Past records are never edited with the
 * event form (the database refuses update_event for them).
 */
export function PastEventDialog({
  event,
  onClose,
  onSaved,
}: {
  event?: HubEvent;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { session, roles, profile } = useAuth();
  const qc = useQueryClient();
  const nc = roles.includes("national_coordinator"),
    director = roles.includes("regional_director");
  const branchesFn = useServerFn(eventBranches),
    createFn = useServerFn(createPastEvent),
    updateFn = useServerFn(updatePastEvent),
    reserve = useServerFn(reserveEventMedia),
    removeMedia = useServerFn(deleteEventMedia),
    reorder = useServerFn(reorderEventMedia),
    setSize = useServerFn(setEventMediaSize),
    setGallery = useServerFn(setEventMediaGallery),
    addVideo = useServerFn(addEventVideo);
  const branches = useQuery({
    queryKey: ["event-branches", session?.user.id],
    queryFn: () => branchesFn(),
    enabled: !nc,
  });
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event?.start_date ?? "");
  const [branch, setBranch] = useState<string>(
    event ? (event.branch_id ?? "") : nc || director ? "" : (profile?.branch_id ?? ""),
  );
  const [description, setDescription] = useState(event?.description ?? "");
  const [photos, setPhotos] = useState<Photo[]>(
    (event?.media ?? [])
      .filter((m) => m.kind === "image")
      .map((m) => ({
        key: m.id,
        name: m.original_name || m.id,
        media: m,
        inGallery: !!m.in_gallery,
        ...(m.url ? { preview: m.url } : {}),
      })),
  );
  const attached = useRef<EventMedia[]>((event?.media ?? []).filter((m) => m.kind === "image"));
  const [videoUrl, setVideoUrl] = useState(""),
    [videos, setVideos] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(event?.id ?? null);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
  // Branch managers record their own branch (the list holds just that one).
  useEffect(() => {
    if (!nc && !director && !branch && branches.data?.[0]) setBranch(branches.data[0].id);
  }, [nc, director, branch, branches.data]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setPreparing(true);
    setError("");
    const next = [...photos];
    const rejected: string[] = [];
    for (const original of Array.from(files)) {
      if (next.length >= MAX_PAST_EVENT_PHOTOS) {
        rejected.push(t("pastEvents.tooManyPhotos"));
        break;
      }
      try {
        if (!original.type.startsWith("image/")) throw new Error("Invalid event file");
        const file = await prepareEventFile(original, 0);
        const preview = URL.createObjectURL(file);
        previews.current.push(preview);
        next.push({
          key: crypto.randomUUID(),
          name: original.name,
          file,
          preview,
          inGallery: true,
        });
      } catch (e) {
        rejected.push(t("events.fileRejected", { name: original.name, reason: translateError(e) }));
      }
    }
    setPhotos(next);
    if (rejected.length) setError(rejected.join(" "));
    setPreparing(false);
  }
  function addVideoUrl() {
    setErrors((e) => ({ ...e, video: "" }));
    const id = youtubeId(videoUrl);
    if (!id) return setErrors((e) => ({ ...e, video: "pastEvents.invalidYoutube" }));
    if (videos.some((v) => youtubeId(v) === id))
      return setErrors((e) => ({ ...e, video: "pastEvents.duplicateVideo" }));
    if (videos.length >= MAX_EVENT_VIDEOS)
      return setErrors((e) => ({ ...e, video: "pastEvents.tooManyVideos" }));
    setVideos([...videos, videoUrl.trim()]);
    setVideoUrl("");
  }

  async function submit() {
    if (busy) return;
    if (preparing) return setError(t("events.filePreparing"));
    const found = validatePastEvent(
      { title, date, branchId: branch || null, photos: photos.length },
      !nc,
    );
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError("");
    let id = savedId;
    try {
      const fields = { title: title.trim(), date, branchId: nc ? null : branch, description };
      if (id) await updateFn({ data: { id, ...fields } });
      else {
        id = await createFn({ data: fields });
        setSavedId(id);
      }
      // Photos: removed ones first (Storage before the row), then the new ones (reserve → upload → size).
      for (const old of [...attached.current])
        if (!photos.some((p) => p.media?.id === old.id)) {
          await removeStoredEventFile(old.storage_path);
          await removeMedia({ data: { id: old.id } });
          attached.current = attached.current.filter((m) => m.id !== old.id);
        }
      const done: Photo[] = [];
      for (const photo of photos) {
        if (!photo.file) {
          done.push(photo);
          continue;
        }
        const extension = eventFileExtension(photo.file.type, photo.file.name);
        if (extension !== "jpg" && extension !== "png" && extension !== "webp")
          throw new Error("Invalid event file");
        const row = await reserve({
          data: { eventId: id, kind: "image", extension, originalName: photo.name.slice(0, 255) },
        });
        try {
          await uploadEventFile(row.storage_path, photo.file);
        } catch (e) {
          await removeMedia({ data: { id: row.id } }).catch(() => undefined);
          throw e;
        }
        const size = preparedImageSize(photo.file);
        if (size) await setSize({ data: { id: row.id, ...size } });
        const media: EventMedia = { ...row, url: photo.preview ?? null };
        attached.current.push(media);
        const saved: Photo = {
          key: row.id,
          name: photo.name,
          media,
          inGallery: photo.inGallery,
          ...(photo.preview ? { preview: photo.preview } : {}),
        };
        done.push(saved);
        setPhotos((current) => current.map((p) => (p.key === photo.key ? saved : p)));
      }
      await reorder({
        data: { eventId: id, ids: done.flatMap((p) => (p.media ? [p.media.id] : [])) },
      });
      for (const p of done)
        if (p.media && p.inGallery !== !!p.media.in_gallery) {
          await setGallery({ data: { id: p.media.id, inGallery: p.inGallery } });
          p.media.in_gallery = p.inGallery;
        }
      for (const url of videos) await addVideo({ data: { eventId: id, url } });
      setVideos([]);
      await Promise.all(
        ["events", "event", "event-videos"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(t("pastEvents.saved"));
      onSaved(id);
    } catch (e) {
      setError(id ? `${t("events.partialError")} ${translateError(e)}` : translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`past-event-${key}-error`} role="alert" className="text-sm text-destructive">
        {t(errors[key])}
      </p>
    ) : null;
  return (
    <EventDialog
      open
      onClose={() => {
        if (!busy && !preparing) onClose();
      }}
      title={event ? t("pastEvents.editTitle") : t("pastEvents.addTitle")}
      testId="past-event-dialog"
    >
      <form
        noValidate
        data-testid="past-event-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("pastEvents.intro")}</p>
        <div className="space-y-1.5">
          <Label htmlFor="past-event-title">{t("events.titleLabel")} *</Label>
          <Input
            id="past-event-title"
            data-testid="past-event-title"
            value={title}
            maxLength={200}
            disabled={busy}
            aria-invalid={!!errors["title"]}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11"
          />
          {fieldError("title")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="past-event-date">{t("pastEvents.date")} *</Label>
            <Input
              id="past-event-date"
              data-testid="past-event-date"
              type="date"
              max={londonToday()}
              value={date}
              disabled={busy}
              aria-invalid={!!errors["date"]}
              onChange={(e) => setDate(e.target.value)}
              className="h-11"
            />
            {fieldError("date")}
          </div>
          <div className="space-y-1.5">
            <Label>
              {t("events.branch")}
              {!nc && " *"}
            </Label>
            {nc ? (
              <p data-testid="past-event-national" className="flex min-h-11 items-center text-sm">
                {t("events.national")}
              </p>
            ) : (
              <Select
                value={branch}
                disabled={busy || branches.isLoading || !director}
                onValueChange={setBranch}
              >
                <SelectTrigger
                  data-testid="past-event-branch"
                  aria-label={t("events.branch")}
                  className="h-11"
                >
                  <SelectValue placeholder={t("auth.chooseBranch")} />
                </SelectTrigger>
                <SelectContent>
                  {(branches.data ?? []).map((b) => (
                    <SelectItem
                      key={b.id}
                      value={b.id}
                      data-testid={`past-event-branch-option-${b.id}`}
                    >
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {fieldError("branch")}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="past-event-description">{t("events.description")}</Label>
          <Textarea
            id="past-event-description"
            data-testid="past-event-description"
            value={description}
            maxLength={5000}
            rows={4}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <section className="space-y-3" aria-labelledby="past-event-photos-title">
          <h3 id="past-event-photos-title" className="font-semibold">
            {t("pastEvents.photos")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("pastEvents.photoLimits", { count: MAX_PAST_EVENT_PHOTOS })}
          </p>
          <Label
            htmlFor="past-event-file-input"
            className="flex min-h-11 items-center gap-2 text-primary"
          >
            <Upload className="size-4" />
            {t("pastEvents.addPhotos")}
          </Label>
          <Input
            id="past-event-file-input"
            data-testid="past-event-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy || preparing || photos.length >= MAX_PAST_EVENT_PHOTOS}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {preparing && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("events.filePreparing")}
            </p>
          )}
          {fieldError("photos")}
          <ol className="space-y-2">
            {photos.map((p, i) => (
              <li
                key={p.key}
                data-testid="past-event-photo"
                data-position={i}
                className="flex min-w-0 flex-wrap items-center gap-2 border-b py-2"
              >
                {p.preview ? (
                  <img src={p.preview} alt="" className="size-12 rounded-md object-cover" />
                ) : (
                  <Image className="size-6 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 break-all text-xs">{p.name}</span>
                <div className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`past-event-photo-gallery-${p.key}`}
                    data-testid="past-event-photo-gallery"
                    checked={p.inGallery}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      setPhotos((current) =>
                        current.map((x) => (x.key === p.key ? { ...x, inGallery: v === true } : x)),
                      )
                    }
                  />
                  <Label htmlFor={`past-event-photo-gallery-${p.key}`} className="text-xs">
                    {t("events.showInGallery")}
                  </Label>
                </div>
                <Button
                  data-testid="past-event-photo-remove"
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy || preparing}
                  aria-label={t("events.remove")}
                  title={t("events.remove")}
                  onClick={() => setPhotos(photos.filter((x) => x.key !== p.key))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>
        </section>
        <section className="space-y-3" aria-labelledby="past-event-videos-title">
          <h3 id="past-event-videos-title" className="font-semibold">
            {t("pastEvents.videos")}
          </h3>
          {savedId && <EventVideos eventId={savedId} canManage />}
          {!savedId && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="past-event-video-url">{t("pastEvents.youtubeLink")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="past-event-video-url"
                    data-testid="past-event-video-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://youtu.be/…"
                    value={videoUrl}
                    disabled={busy || videos.length >= MAX_EVENT_VIDEOS}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addVideoUrl();
                      }
                    }}
                    className="h-11 min-w-0"
                  />
                  <Button
                    data-testid="past-event-video-add"
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={busy || !videoUrl.trim() || videos.length >= MAX_EVENT_VIDEOS}
                    onClick={addVideoUrl}
                  >
                    <Plus />
                    {t("pastEvents.addVideo")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("pastEvents.youtubeHint")}</p>
                {fieldError("video")}
              </div>
              {videos.length > 0 && (
                <ul className="space-y-1">
                  {videos.map((v) => (
                    <li
                      key={v}
                      data-testid="past-event-video"
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 break-all">{v}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("events.remove")}
                        title={t("events.remove")}
                        disabled={busy}
                        onClick={() => setVideos(videos.filter((x) => x !== v))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
        {error && (
          <p data-testid="past-event-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button data-testid="past-event-save" type="submit" disabled={busy || preparing}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}
