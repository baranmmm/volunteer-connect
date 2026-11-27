// Production-like media volume for profiling page loads on the local stack (never QA): 22 past event records like
// production after the Medway import — 7 Medway records × 12 photos and 15 other-branch records × 6 photos, each with
// its w640/w1280 copies — on top of local:seed and local:seed-media (2 Medway albums, 4 sample records).
// Run after local:seed and local:seed-media:  npm run local:seed-perf   (idempotent: skips records that exist).
// The extra public records change the counts other specs see: run `npm run local:reset && npm run local:seed` before
// the Playwright suite again.
import { adminClient } from "../api/SupabaseClient";
import { addEventPagePhotoAs, createPastEventAs, gradientPhoto, PALETTE } from "../api/media";
import { readSeedState } from "../data/users";
import { isLocalTarget, isMain } from "./env";
import { acquireLocalStackLock } from "./local-lock";
import { assertQaEnvironment } from "./guard";

const SIZES: [number, number][] = [[1920, 1280], [1280, 1920], [1600, 1200], [1920, 1080]];
const MEDWAY = 7;
const OTHER = 15;

export async function seedPerfVolume() {
  assertQaEnvironment();
  if (!isLocalTarget()) throw new Error("seed-perf-volume runs on the local stack only (E2E_TARGET=local).");
  const seed = readSeedState();
  const plan = [
    ...Array.from({ length: MEDWAY }, (_, i) => ({
      email: seed.users.managerMedway.email,
      branch: seed.branches.Medway,
      title: `Perf Medway record ${i + 1}`,
      photos: 12,
    })),
    ...Array.from({ length: OTHER }, (_, i) => ({
      email: seed.users.managerBrighton.email,
      branch: seed.branches.Brighton,
      title: `Perf Brighton record ${i + 1}`,
      photos: 6,
    })),
  ];
  let created = 0;
  let photos = 0;
  for (const [n, p] of plan.entries()) {
    const found = await adminClient().from("events").select("id").eq("title", p.title).eq("branch_id", p.branch);
    if (found.data?.length) continue;
    const id = await createPastEventAs(p.email, p.branch, p.title, 20 + n * 25, `Perf venue ${n + 1}`);
    for (let i = 0; i < p.photos; i++) {
      const [w, h] = SIZES[(n + i) % SIZES.length]!;
      await addEventPagePhotoAs(p.email, id, await gradientPhoto(PALETTE[(n + i) % PALETTE.length]!, 1000 + n * 20 + i, w, h));
      photos++;
    }
    created++;
  }
  console.log(`[seed-perf] ${created} records created, ${photos} photos (with copies); ${plan.length - created} already there.`);
}

if (isMain(import.meta.url)) {
  const release = acquireLocalStackLock("local:seed-perf");
  seedPerfVolume()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    })
    .finally(release);
}
