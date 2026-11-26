// Local stack only: sample Media data for visual checks (never QA, never production). Placeholder photos (colour
// gradients) only. The sample events are past records, which are public: they show on the public events page and
// map, which other specs count, so run `npm run local:reset && npm run local:seed` before the Playwright suite. Creates, as the seeded Medway/Brighton managers and the Medway volunteer, through the app's RPCs:
//   * past Medway event records with photos on their event pages and Media-only photos ("2026 Iftar Dinner", "2025
//     Christmas Dinner") and a third ("Peace Walk");
//   * one Brighton event with photos (it must never appear in Medway's gallery);
//   * two Medway albums ("Volunteer meet-ups", "Ramadan 2026");
//   * one pending upload request from the Medway volunteer.
// Run after local:seed:  npm run local:seed-media   (idempotent: does nothing when the sample events exist).
import { adminClient } from "../api/SupabaseClient";
import { addEventPagePhotoAs, addLibraryPhotoAs, createAlbumAs, createPastEventAs, gradientPhoto, PALETTE, uploadRequestAs } from "../api/media";
import { readSeedState } from "../data/users";
import { isLocalTarget, isMain } from "./env";
import { acquireLocalStackLock } from "./local-lock";
import { assertQaEnvironment } from "./guard";

const DAY = 24 * 60;

async function photos(from: number, count: number) {
  return Promise.all(Array.from({ length: count }, (_, i) => gradientPhoto(PALETTE[(from + i) % PALETTE.length]!, from * 10 + i)));
}

export async function seedMedia() {
  assertQaEnvironment();
  if (!isLocalTarget()) throw new Error("seed-media runs on the local stack only (E2E_TARGET=local).");
  const seed = readSeedState();
  const medway = seed.branches.Medway, brighton = seed.branches.Brighton;
  const bm = seed.users.managerMedway.email, bmB = seed.users.managerBrighton.email, vol = seed.users.volunteerMedway.email;
  const existing = await adminClient().from("events").select("id").eq("title", "2026 Iftar Dinner").eq("branch_id", medway);
  if (existing.data?.length) {
    console.log("[seed-media] Sample media already there: nothing to do.");
    return;
  }
  // Past records (published events cannot end in the past): create_past_event as the branch manager.
  const event = (email: string, branchId: string, title: string, daysAgo: number, location: string) =>
    createPastEventAs(email, branchId, title, daysAgo, location);
  const iftar = await event(bm, medway, "2026 Iftar Dinner", 20, "Rochester Cathedral");
  const xmas = await event(bm, medway, "2025 Christmas Dinner", 120, "Chatham Community Hall");
  const walk = await event(bm, medway, "Peace Walk", 60, "Rochester Esplanade");
  const other = await event(bmB, brighton, "Brighton Interfaith Picnic", 10, "Preston Park");

  for (const p of await photos(0, 3)) await addEventPagePhotoAs(bm, iftar, p);
  for (const p of await photos(3, 9)) await addLibraryPhotoAs(bm, medway, { event_id: iftar }, p);
  for (const p of await photos(4, 2)) await addEventPagePhotoAs(bm, xmas, p);
  for (const p of await photos(6, 6)) await addLibraryPhotoAs(bm, medway, { event_id: xmas }, p);
  for (const p of await photos(2, 4)) await addLibraryPhotoAs(bm, medway, { event_id: walk }, p);
  for (const p of await photos(5, 3)) await addEventPagePhotoAs(bmB, other, p);

  const meetups = await createAlbumAs(bm, medway, "Volunteer meet-ups");
  for (const p of await photos(7, 5)) await addLibraryPhotoAs(bm, medway, { album_id: meetups }, p);
  const ramadan = await createAlbumAs(bm, medway, "Ramadan 2026", new Date(Date.now() - 30 * DAY * 60_000).toISOString().slice(0, 10));
  for (const p of await photos(1, 4)) await addLibraryPhotoAs(bm, medway, { album_id: ramadan }, p);

  await uploadRequestAs(vol, { event_id: iftar }, await photos(8, 3), "From the evening at the cathedral");
  console.log("[seed-media] Sample media created: 3 Medway events, 1 Brighton event, 2 albums, 1 pending upload request.");
}

if (isMain(import.meta.url)) {
  acquireLocalStackLock("local:seed-media");
  seedMedia().catch((e) => {
    console.error(`[seed-media] ${(e as Error).message}`);
    process.exit(1);
  });
}
