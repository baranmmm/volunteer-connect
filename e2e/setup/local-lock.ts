// One session at a time on the local Supabase stack. Every worktree uses the same Docker stack (project
// dsvh-e2e-local, fixed ports), so a reset, seed or migration in one session breaks another session's running tests
// (deleted users, a new NC secret). Every local command (local:up/reset/down/migrate/seed/dryrun and local:test) takes
// this machine-wide lock first and refuses to start while another live process holds it. A lock left by a process
// that is gone is taken over. Child processes of the holder (local:reset runs migrate and seed) inherit the lock
// through E2E_LOCAL_LOCK_HOLDER. E2E_LOCAL_LOCK=off skips the lock (CI runners have a stack each).
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCAL_LOCK_FILE = path.join(os.homedir(), ".cache", "dsvh-e2e", "local-stack.lock");
const HOLDER_ENV = "E2E_LOCAL_LOCK_HOLDER";

type Holder = { pid: number; cwd: string; command: string; since: string };

function readHolder(): Holder | null {
  try {
    return JSON.parse(readFileSync(LOCAL_LOCK_FILE, "utf8")) as Holder;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Takes the lock for `command`, or throws naming the session that holds it. Returns the release function. */
export function acquireLocalStackLock(command: string): () => void {
  if (process.env["E2E_LOCAL_LOCK"] === "off") return () => undefined;
  const inherited = Number(process.env[HOLDER_ENV]);
  const current = readHolder();
  if (inherited && current?.pid === inherited && alive(inherited)) return () => undefined;
  mkdirSync(path.dirname(LOCAL_LOCK_FILE), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCAL_LOCK_FILE, "wx");
      const holder: Holder = { pid: process.pid, cwd: process.cwd(), command, since: new Date().toISOString() };
      writeSync(fd, JSON.stringify(holder));
      closeSync(fd);
      process.env[HOLDER_ENV] = String(process.pid);
      const release = () => {
        if (readHolder()?.pid !== process.pid) return;
        try {
          unlinkSync(LOCAL_LOCK_FILE);
        } catch {
          /* already gone */
        }
      };
      process.once("exit", release);
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          release();
          process.exit(130);
        });
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = readHolder();
      if (holder && holder.pid !== process.pid && alive(holder.pid)) {
        throw new Error(
          `[local-lock] The local Supabase stack is in use by another session: "${holder.command}" (pid ${holder.pid}) in ` +
            `${holder.cwd} since ${holder.since}. Only one session may run local e2e at a time (CLAUDE.md). Wait for it ` +
            `to finish; if that process is not yours to wait for, ask the user. Lock file: ${LOCAL_LOCK_FILE}`,
        );
      }
      // The holder is gone (crashed or killed): take the lock over.
      try {
        unlinkSync(LOCAL_LOCK_FILE);
      } catch {
        /* removed meanwhile */
      }
    }
  }
  throw new Error(`[local-lock] Could not take ${LOCAL_LOCK_FILE}`);
}
