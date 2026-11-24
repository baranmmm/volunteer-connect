import type { TaskStatus } from "@/lib/tasks";

// Task status tints (Kanban columns, cards and status badges), light and dark. The status label is always written
// next to the colour, so colour is never the only cue. Text on every tint keeps WCAG AA contrast (at least 4.5:1):
// src/test/task-status-colors.test.ts checks every pair below, including the theme's foreground, muted-foreground,
// destructive and primary text on the column and card tints. The class strings repeat the hex values literally because
// Tailwind only generates classes it finds in the source.

export type StatusTint = {
  /** Kanban column background. */
  column: string;
  /** Task card background (lighter than its column). */
  card: string;
  /** Badge background, text and border. */
  badgeBg: string;
  badgeFg: string;
  badgeBorder: string;
};

export const TASK_STATUS_TINTS: Record<"light" | "dark", Record<TaskStatus, StatusTint>> = {
  light: {
    todo: {
      column: "#EEF1F5",
      card: "#F8FAFC",
      badgeBg: "#E2E7EE",
      badgeFg: "#374151",
      badgeBorder: "#9AA4B2",
    },
    in_progress: {
      column: "#E4F1FA",
      card: "#F4FAFE",
      badgeBg: "#D3EAF8",
      badgeFg: "#004F73",
      badgeBorder: "#6FAED3",
    },
    blocked: {
      column: "#FCEBEA",
      card: "#FFF7F6",
      badgeBg: "#FADAD8",
      badgeFg: "#8F1A17",
      badgeBorder: "#E39490",
    },
    done: {
      column: "#E3F4E9",
      card: "#F5FCF7",
      badgeBg: "#D2EEDC",
      badgeFg: "#145A32",
      badgeBorder: "#7FC29A",
    },
  },
  dark: {
    todo: {
      column: "#1C222B",
      card: "#242B35",
      badgeBg: "#2F3845",
      badgeFg: "#E5E9EF",
      badgeBorder: "#5B6675",
    },
    in_progress: {
      column: "#0D2533",
      card: "#112F41",
      badgeBg: "#123F59",
      badgeFg: "#D2ECFB",
      badgeBorder: "#3C7FA6",
    },
    blocked: {
      column: "#2B1414",
      card: "#361A1A",
      badgeBg: "#4D1F1F",
      badgeFg: "#FBD9D7",
      badgeBorder: "#A04A47",
    },
    done: {
      column: "#10251A",
      card: "#152F21",
      badgeBg: "#1A4029",
      badgeFg: "#CDF2DA",
      badgeBorder: "#3F8A5D",
    },
  },
};

/** Status badges. In dark mode the badge text uses the light badge foreground of the dark palette. */
export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  todo: "border-[#9AA4B2] bg-[#E2E7EE] text-[#374151] dark:border-[#5B6675] dark:bg-[#2F3845] dark:text-[#E5E9EF]",
  in_progress:
    "border-[#6FAED3] bg-[#D3EAF8] text-[#004F73] dark:border-[#3C7FA6] dark:bg-[#123F59] dark:text-[#D2ECFB]",
  blocked:
    "border-[#E39490] bg-[#FADAD8] text-[#8F1A17] dark:border-[#A04A47] dark:bg-[#4D1F1F] dark:text-[#FBD9D7]",
  done: "border-[#7FC29A] bg-[#D2EEDC] text-[#145A32] dark:border-[#3F8A5D] dark:bg-[#1A4029] dark:text-[#CDF2DA]",
};

/** Kanban columns (the heading text uses the theme foreground in light mode, the badge foreground in dark mode). */
export const TASK_STATUS_COLUMN: Record<TaskStatus, string> = {
  todo: "bg-[#EEF1F5] dark:bg-[#1C222B] dark:text-[#E5E9EF]",
  in_progress: "bg-[#E4F1FA] dark:bg-[#0D2533] dark:text-[#D2ECFB]",
  blocked: "bg-[#FCEBEA] dark:bg-[#2B1414] dark:text-[#FBD9D7]",
  done: "bg-[#E3F4E9] dark:bg-[#10251A] dark:text-[#CDF2DA]",
};

/** Task cards. */
export const TASK_STATUS_CARD: Record<TaskStatus, string> = {
  todo: "bg-[#F8FAFC] dark:bg-[#242B35] dark:text-[#E5E9EF]",
  in_progress: "bg-[#F4FAFE] dark:bg-[#112F41] dark:text-[#D2ECFB]",
  blocked: "bg-[#FFF7F6] dark:bg-[#361A1A] dark:text-[#FBD9D7]",
  done: "bg-[#F5FCF7] dark:bg-[#152F21] dark:text-[#CDF2DA]",
};

// ---------------------------------------------------------------------------------------------------------------
// Mine and other people's tasks (Kanban cards, list rows, calendar items). With every task shown, the caller's own
// tasks stand out with an accent left border, a light primary tint layered over the status tint (a background image,
// so the status colour stays) and the "Assigned to you" badge. Other people's tasks are quieter: muted title text and
// no shadow, back to full strength on hover and keyboard focus (focus-within). No opacity is used: at 0.75 opacity the
// muted and destructive text fell below 4.5:1, so the quiet look comes from the muted-foreground token, which
// src/test/task-status-colors.test.ts checks on every surface (card tints, list rows, calendar items, their hover and
// the mine tint).

/** The primary tint over mine (light: brand #006D9C at 6 %, dark: a lighter blue at 12 %). */
export const MINE_TINT = { light: "#006D9C0F", dark: "#5BB8E61F" } as const;
/** Mine: accent border plus tint. */
export const TASK_MINE =
  "border-l-4 border-l-primary bg-[linear-gradient(#006D9C0F,#006D9C0F)] dark:bg-[linear-gradient(#5BB8E61F,#5BB8E61F)]";
/** Other people's card or row (needs `group` on the same element). */
export const TASK_OTHER = "group shadow-none hover:shadow-sm focus-within:shadow-sm";
/** Text inside an other people's card or row: muted until hover or focus. Dark mode keeps the tint's own text. */
export const TASK_OTHER_TEXT =
  "text-muted-foreground group-hover:text-foreground group-focus-within:text-foreground dark:text-inherit dark:group-hover:text-inherit dark:group-focus-within:text-inherit";
