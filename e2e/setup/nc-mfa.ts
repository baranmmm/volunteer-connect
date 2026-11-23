// QA only, run by a person (never by CI or an agent): enrols a new TOTP authenticator for the seeded National
// Coordinator and stores its secret as E2E_NC_TOTP_SECRET in e2e/.env.qa. The value is never printed: copy it from
// .env.qa into the GitHub `qa` environment secret of the same name.
//   cd e2e && npm run qa:nc-mfa
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { enrollTotp } from "../api/SupabaseClient";
import { seedEmail } from "../data/users";
import { E2E_DIR, isLocalTarget } from "./env";
import { assertQaEnvironment } from "./guard";

async function main() {
  assertQaEnvironment();
  if (isLocalTarget()) throw new Error("The local stack enrols the NC itself (npm run local:seed).");
  const file = path.join(E2E_DIR, ".env.qa");
  if (!existsSync(file)) throw new Error("e2e/.env.qa not found");
  const secret = await enrollTotp(seedEmail("nationalCoordinator"));
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => !l.startsWith("E2E_NC_TOTP_SECRET="));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  writeFileSync(file, `${lines.join("\n")}\nE2E_NC_TOTP_SECRET=${secret}\n`);
  console.log("[nc-mfa] Enrolled a new authenticator for the QA National Coordinator.");
  console.log("[nc-mfa] Saved E2E_NC_TOTP_SECRET in e2e/.env.qa (value not shown). Add the same value to the GitHub `qa` environment.");
}

main().catch((e) => {
  console.error(`[nc-mfa] ${(e as Error).message}`);
  process.exit(1);
});
