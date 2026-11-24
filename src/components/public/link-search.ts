// Search params and head meta of the email link pages (/e/confirm, /e/cancel, /updates/…). Kept apart from the page
// components so route definitions stay small and these pages' code is loaded only when they are opened.
import { z } from "zod";

/** ?t=<signed token> on the email link pages. */
const tokenSearch = z.object({ t: z.string().min(1).max(100).optional() }).catch({});

export function validateTokenSearch(search: Record<string, unknown>): { t?: string } {
  const parsed = tokenSearch.parse({ t: search["t"] });
  return parsed.t ? { t: parsed.t } : {};
}

/** Token links must not leak to other sites through the Referer header. */
export const noReferrer = { name: "referrer", content: "no-referrer" };
