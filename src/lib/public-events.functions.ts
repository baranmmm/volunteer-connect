import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { branchParam } from "@/lib/public-events";

// Signed-out pages (/events, /events/:id): no auth middleware on purpose. Everything goes through the anon-executable
// get_public_* database functions, which return only public fields of public events.
export const getPublicEvents = createServerFn({ method: "POST" })
  .inputValidator(z.object({ branch: branchParam, includeCancelled: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { fetchPublicEvents } = await import("@/lib/public-events.server");
    return fetchPublicEvents({ branchSlugs: data.branch ?? null, months: 12, includeCancelled: !!data.includeCancelled });
  });

export const getPublicEvent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { fetchPublicEvent, signedPublicImage } = await import("@/lib/public-events.server");
    const event = await fetchPublicEvent(data.id);
    if (!event) return null;
    return { event, image: event.has_image ? await signedPublicImage(event.id) : null };
  });

export const getPublicStructure = createServerFn({ method: "POST" }).handler(async () => {
  const { publicStructure } = await import("@/lib/public-events.server");
  return publicStructure();
});
