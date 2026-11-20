// Playwright "setup" project: one storageState per seeded role.
// Sessions come from a password sign-in against the QA Auth API (the UI sign-in itself is covered once,
// in tests/ui/auth.spec.ts). The app keeps its Supabase session in localStorage, so injecting it is enough.
import { test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { signIn, storageStateFor } from "../api/SupabaseClient";
import { STORAGE_ROLES, readSeedState } from "../data/users";
import { AUTH_DIR, baseUrl, storageFile } from "./env";

setup("create a storageState per role", async () => {
  const state = readSeedState();
  mkdirSync(AUTH_DIR, { recursive: true });
  const origin = new URL(baseUrl()).origin;
  for (const role of STORAGE_ROLES) {
    const session = await signIn(state.users[role].email);
    writeFileSync(storageFile(role), JSON.stringify(storageStateFor(session, origin)));
  }
});
