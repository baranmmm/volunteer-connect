// Opt-in timing of server function calls (PERF_LOG=1 in the server's environment; off in production). For every
// /_serverFn request it logs one line: total ms, the time spent in database (PostgREST) and Storage calls (summed, so
// parallel calls can add up to more than the total), their counts, and how many Storage objects were signed.
// Used to profile page loads on the local stack (e2e/tests/perf/page-load.spec.ts); never logs URLs, keys or data.
import { AsyncLocalStorage } from "node:async_hooks";

type Rec = { db: number; dbCalls: number; storage: number; storageCalls: number; signed: number };

const store = new AsyncLocalStorage<Rec>();
let installed = false;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Objects in one Storage sign request: `{ paths: [...] }` for a batch, otherwise one. */
function signedCount(body: unknown): number {
  if (typeof body !== "string") return 1;
  try {
    const parsed = JSON.parse(body) as { paths?: unknown };
    return Array.isArray(parsed.paths) ? parsed.paths.length : 1;
  } catch {
    return 1;
  }
}

function install() {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rec = store.getStore();
    if (!rec) return original(input, init);
    const url = urlOf(input);
    const started = performance.now();
    try {
      return await original(input, init);
    } finally {
      const ms = performance.now() - started;
      if (url.includes("/rest/v1/")) {
        rec.db += ms;
        rec.dbCalls++;
      } else if (url.includes("/storage/v1/")) {
        rec.storage += ms;
        rec.storageCalls++;
        if (url.includes("/object/sign/")) rec.signed += signedCount(init?.body);
      }
    }
  };
}

export const perfLogEnabled = () => process.env["PERF_LOG"] === "1";

/** Runs one request with timing; logs a line for server function calls. */
export async function withPerfLog<T>(request: Request, run: () => T | Promise<T>): Promise<T> {
  const path = new URL(request.url).pathname;
  if (!path.includes("/_serverFn/")) return await run();
  install();
  const rec: Rec = { db: 0, dbCalls: 0, storage: 0, storageCalls: 0, signed: 0 };
  const started = performance.now();
  try {
    return await store.run(rec, async () => await run());
  } finally {
    const id = path.split("/_serverFn/")[1]?.split(/[/?]/)[0] ?? "?";
    console.log(
      `[perf] fn=${id} total=${Math.round(performance.now() - started)}ms ` +
        `db=${Math.round(rec.db)}ms/${rec.dbCalls} storage=${Math.round(rec.storage)}ms/${rec.storageCalls} ` +
        `signed=${rec.signed}`,
    );
  }
}
