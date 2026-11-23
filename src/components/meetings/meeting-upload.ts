import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { translateError } from "@/lib/i18n";
import {
  MEETING_FILE_BUCKET,
  meetingFileContentType,
  meetingFileExtension,
  validateMeetingFile,
} from "@/lib/meetings";
import { prepareMeetingFile } from "./meeting-ui";

type Slot = { id: string; storage_path: string };

/**
 * Uploads files to a meeting: each reserves a slot (row + path) first, then the browser uploads to that path; a failed
 * upload removes the object (if any) and the row. Used by the files section and the create form. Returns how many
 * were uploaded and one translated message per rejected file.
 */
export async function uploadMeetingFiles({
  meetingId,
  files,
  existing,
  reserve,
  removeRow,
  t,
}: {
  meetingId: string;
  files: File[];
  existing: number;
  reserve: (args: {
    data: { meetingId: string; extension: string; originalName: string };
  }) => Promise<Slot>;
  removeRow: (args: { data: { id: string } }) => Promise<unknown>;
  t: TFunction;
}): Promise<{ uploaded: number; failed: string[] }> {
  const failed: string[] = [];
  let count = existing,
    uploaded = 0;
  for (const original of files) {
    const reason = validateMeetingFile(original, count);
    if (reason) {
      failed.push(t("meetings.files.rejected", { name: original.name, reason: t(reason) }));
      continue;
    }
    const ext = meetingFileExtension(original.type, original.name)!;
    const contentType = meetingFileContentType(ext);
    let slot: Slot | null = null;
    let stored = false;
    try {
      const file = await prepareMeetingFile(original, ext, contentType);
      slot = await reserve({
        data: { meetingId, extension: ext, originalName: original.name.slice(0, 255) },
      });
      const { error } = await supabase.storage
        .from(MEETING_FILE_BUCKET)
        .upload(slot.storage_path, file, { contentType, upsert: false });
      if (error) throw error;
      stored = true;
      count += 1;
      uploaded += 1;
    } catch (e) {
      failed.push(t("meetings.files.rejected", { name: original.name, reason: translateError(e) }));
      if (slot && !stored) {
        const path = slot.storage_path;
        await supabase.storage
          .from(MEETING_FILE_BUCKET)
          .remove([path])
          .catch(() => undefined);
        await removeRow({ data: { id: slot.id } }).catch(() => undefined);
      }
    }
  }
  return { uploaded, failed };
}
