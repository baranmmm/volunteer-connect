// Playwright globalSetup for local runs: the one-session-at-a-time lock on the local stack (setup/local-lock.ts),
// held by the runner process for the whole run and released when it exits (the returned teardown runs first).
import { acquireLocalStackLock } from "./local-lock";

export default function globalSetup() {
  return acquireLocalStackLock(`local:test ${process.argv.slice(2).join(" ")}`.trim());
}
