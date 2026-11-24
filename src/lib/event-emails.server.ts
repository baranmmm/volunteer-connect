// Sends queued event emails right after a manager's change (update, cancellation, announcement). Server only.
import { getRequest } from "@tanstack/react-start/server";

function origin(): string | null {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return null;
  }
}

/**
 * Flushes the email outbox up to `maxPriority` (1 transactional, 3 announcements). Never throws: the change is
 * already saved and the queue keeps anything that could not be sent now (the scheduled sender retries).
 */
export async function flushEventEmails(maxPriority: 1 | 2 | 3 = 1, max?: number): Promise<void> {
  try {
    const { flushOutbox } = await import("@/lib/email/outbox.server");
    await flushOutbox({ maxPriority, origin: origin(), ...(max ? { max } : {}) });
  } catch {
    /* non-fatal: rows stay queued */
  }
}
