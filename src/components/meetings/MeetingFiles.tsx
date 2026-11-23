import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Download, FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  MEETING_FILE_ACCEPT,
  MEETING_FILE_BUCKET,
  meetingFileContentType,
  meetingFileExtension,
  validateMeetingFile,
  type MeetingDetail,
} from "@/lib/meetings";
import { deleteMeetingFile, reserveMeetingFile } from "@/lib/meetings.functions";
import { prepareMeetingFile } from "./meeting-ui";

/**
 * Meeting files: each upload reserves a slot (row + path) first, then the browser uploads to that path; a failed
 * upload removes the object (if any) and the row. Deleting removes the Storage object before the row.
 */
export function MeetingFiles({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const reserve = useServerFn(reserveMeetingFile),
    removeRow = useServerFn(deleteMeetingFile);
  const editable = meeting.can_edit;
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setErrors([]);
    const failed: string[] = [];
    let count = meeting.files.length,
      uploaded = 0;
    for (const original of Array.from(list)) {
      const reason = validateMeetingFile(original, count);
      if (reason) {
        failed.push(t("meetings.files.rejected", { name: original.name, reason: t(reason) }));
        continue;
      }
      const ext = meetingFileExtension(original.type, original.name)!;
      const contentType = meetingFileContentType(ext);
      let slot: { id: string; storage_path: string } | null = null;
      let stored = false;
      try {
        const file = await prepareMeetingFile(original, ext, contentType);
        slot = await reserve({
          data: {
            meetingId: meeting.id,
            extension: ext,
            originalName: original.name.slice(0, 255),
          },
        });
        const { error } = await supabase.storage
          .from(MEETING_FILE_BUCKET)
          .upload(slot.storage_path, file, { contentType, upsert: false });
        if (error) throw error;
        stored = true;
        count += 1;
        uploaded += 1;
      } catch (e) {
        failed.push(
          t("meetings.files.rejected", { name: original.name, reason: translateError(e) }),
        );
        if (slot && !stored) {
          await supabase.storage
            .from(MEETING_FILE_BUCKET)
            .remove([slot.storage_path])
            .catch(() => undefined);
          await removeRow({ data: { id: slot.id } }).catch(() => undefined);
        }
      }
    }
    setErrors(failed);
    if (inputRef.current) inputRef.current.value = "";
    await qc.invalidateQueries({ queryKey: ["meeting", meeting.id] });
    if (uploaded) toast.success(t("meetings.files.uploaded", { count: uploaded }));
    setBusy(false);
  }

  async function remove(file: MeetingDetail["files"][number]) {
    setBusy(true);
    try {
      const { error } = await supabase.storage
        .from(MEETING_FILE_BUCKET)
        .remove([file.storage_path]);
      if (error) throw error;
      await removeRow({ data: { id: file.id } });
      toast.success(t("meetings.files.deleted"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="meeting-files"
      aria-labelledby="meeting-files-title"
      className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id="meeting-files-title" className="text-xl font-semibold">
          {t("meetings.files.title")}
        </h2>
        {editable && (
          <>
            <input
              ref={inputRef}
              id="meeting-file-input"
              data-testid="meeting-file-input"
              type="file"
              multiple
              accept={MEETING_FILE_ACCEPT}
              aria-label={t("meetings.files.upload")}
              tabIndex={-1}
              className="sr-only"
              disabled={busy}
              onChange={(e) => void upload(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11"
              data-testid="meeting-file-upload"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              {busy ? t("meetings.files.working") : t("meetings.files.upload")}
            </Button>
          </>
        )}
      </div>
      {editable && <p className="mt-1 text-xs text-muted-foreground">{t("meetings.files.hint")}</p>}
      {errors.length > 0 && (
        <ul
          role="alert"
          data-testid="meeting-file-errors"
          className="mt-3 space-y-1 text-sm text-destructive"
        >
          {errors.map((message, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              {message}
            </li>
          ))}
        </ul>
      )}
      {meeting.files.length === 0 ? (
        <p data-testid="meeting-files-empty" className="mt-4 text-muted-foreground">
          {t("meetings.files.empty")}
        </p>
      ) : (
        <ul className="mt-4 grid min-w-0 grid-cols-1 gap-2">
          {meeting.files.map((f) => {
            const Icon = f.kind === "image" ? ImageIcon : FileText;
            return (
              <li
                key={f.id}
                data-testid="meeting-file"
                data-file-id={f.id}
                className="flex min-w-0 items-center gap-3 rounded-lg border p-3"
              >
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  title={f.original_name}
                  data-testid="meeting-file-name"
                >
                  {f.original_name}
                </span>
                {f.url && (
                  <Button asChild variant="outline" size="sm" className="h-10 shrink-0">
                    <a
                      data-testid="meeting-file-download"
                      href={f.url}
                      download={f.original_name}
                      rel="noopener noreferrer"
                    >
                      <Download />
                      <span className="sr-only sm:not-sr-only">{t("meetings.files.download")}</span>
                    </a>
                  </Button>
                )}
                {editable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-destructive hover:text-destructive"
                    data-testid="meeting-file-delete"
                    aria-label={t("meetings.files.delete", { name: f.original_name })}
                    disabled={busy}
                    onClick={() => void remove(f)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
