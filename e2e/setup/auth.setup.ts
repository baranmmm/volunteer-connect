// Playwright "setup" project: one storageState per seeded role.
// Sessions come from a password sign-in against the QA Auth API (the UI sign-in itself is covered once,
// in tests/ui/auth.spec.ts). The app keeps its Supabase session in localStorage, so injecting it is enough.
import { test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { signIn, signInAal2, storageStateFor } from "../api/SupabaseClient";
import { NC_ROLE, STORAGE_ROLES, readSeedState } from "../data/users";
import { AUTH_DIR, baseUrl, ncTotpSecret, storageFile } from "./env";

setup("create a storageState per role", async () => {
  const state = readSeedState();
  mkdirSync(AUTH_DIR, { recursive: true });
  const origin = new URL(baseUrl()).origin;
  for (const role of STORAGE_ROLES) {
    const session = await signIn(state.users[role].email);
    writeFileSync(storageFile(role), JSON.stringify(storageStateFor(session, origin)));
  }
  // The National Coordinator signs in with MFA (aal2); without the TOTP secret NC UI tests fail with a clear message.
  const secret = ncTotpSecret();
  if (secret) {
    const session = await signInAal2(state.users[NC_ROLE].email, secret);
    writeFileSync(storageFile(NC_ROLE), JSON.stringify(storageStateFor(session, origin)));
  }
});
