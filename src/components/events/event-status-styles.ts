// Status styling shared by the event components. Colours come only from the --status-* tokens in styles.css.
import { Ban, CircleCheck, PencilLine, Radio } from "lucide-react";
import type { EventDisplayStatus } from "@/lib/event-status";

export type StoredStatus = "draft" | "published" | "cancelled";
export const storedStatus = (status: string): StoredStatus =>
  status === "draft" || status === "cancelled" ? status : "published";

export const STATUS_ICON = {
  draft: PencilLine,
  published: CircleCheck,
  cancelled: Ban,
  live: Radio,
} as const;

/** Badge colours come only from the --status-* theme tokens in styles.css. */
export const STATUS_BADGE: Record<StoredStatus, string> = {
  draft: "border-dashed border-status-draft-border bg-status-draft-bg text-status-draft",
  published: "border-status-published bg-status-published-bg text-status-published",
  cancelled: "border-status-cancelled bg-status-cancelled-bg text-status-cancelled",
};

/** Card surfaces in the list view (and the dashboard rows). */
export const STATUS_CARD: Record<EventDisplayStatus, string> = {
  draft: "border-dashed border-status-draft-border bg-status-draft-bg",
  published: "border-l-4 border-l-status-published bg-card",
  live: "border-l-4 border-l-status-published bg-card",
  cancelled: "border-l-4 border-l-status-cancelled bg-card",
};

/** Compact entries in the month grid. */
export const STATUS_CELL: Record<EventDisplayStatus, string> = {
  draft: "border border-dashed border-status-draft-border bg-status-draft-bg",
  published: "border-l-2 border-status-published bg-status-published-bg",
  live: "border-l-2 border-status-published bg-status-published-bg",
  cancelled: "border-l-2 border-status-cancelled bg-status-cancelled-bg",
};

/** Legend samples: a full outline in the status colour (the live sample uses the Happening now colours). */
export const LEGEND_SWATCH: Record<EventDisplayStatus, string> = {
  draft: "border-2 border-dashed border-status-draft-border bg-status-draft-bg",
  published: "border-2 border-status-published bg-status-published-bg",
  live: "border-2 border-status-live bg-status-live-bg",
  cancelled: "border-2 border-status-cancelled bg-status-cancelled-bg",
};

/** Cancelled titles are struck through everywhere. */
export const cancelledTitle = (status: string) =>
  status === "cancelled" ? "line-through decoration-2" : "";

/** Icon colour per status (legend). */
export const STATUS_TEXT: Record<EventDisplayStatus, string> = {
  draft: "text-status-draft",
  published: "text-status-published",
  live: "text-status-live",
  cancelled: "text-status-cancelled",
};
