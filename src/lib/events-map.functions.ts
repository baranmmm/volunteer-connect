import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { branchParam } from "@/lib/public-events";

// Signed-out map: no auth middleware on purpose (public fields of public events only, like getPublicEvents).
export const getPastPublicEvents = createServerFn({ method: "POST" })
  .inputValidator(z.object({ branch: branchParam }))
  .handler(async ({ data }) => {
    const { fetchPastPublicEvents } = await import("@/lib/events-map.server");
    return fetchPastPublicEvents({ branchSlugs: data.branch ?? null });
  });
