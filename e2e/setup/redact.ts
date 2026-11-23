// Masks test passwords in Playwright artifacts: traces (zip), error-context.md, blob reports (zip), HTML report data.
// Used by setup/redact-reporter.ts (every run, before the html/blob reporters copy anything) and as a CLI safety net
// in CI before artifacts are uploaded: `tsx setup/redact.ts <dir> [<dir> ...]`.
//
// What leaks without it (measured with Playwright 1.65): the step title `Fill "<value>"`, the trace's DOM snapshots
// (`__playwright_value_` of the input) and the ARIA snapshot in error-context.md (`textbox "Password": <value>`).
// Screenshots and videos show password inputs as dots, so they need nothing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import "./env"; // loads e2e/.env.qa (values already in the environment win)
import { isMain } from "./env";

export const MASK = "********";

/** Every value that must never reach an artifact, with the escaped forms it can take in JSON or URLs. */
export function secretValues(env: Record<string, string | undefined> = process.env): string[] {
  const raw = [env["E2E_USER_PASSWORD"]].map((v) => v?.trim()).filter((v): v is string => !!v && v.length >= 4);
  const forms = new Set<string>();
  for (const value of raw) {
    forms.add(value);
    forms.add(JSON.stringify(value).slice(1, -1));
    forms.add(JSON.stringify(JSON.stringify(value)).slice(3, -3)); // JSON inside a JSON string (trace params)
    forms.add(encodeURIComponent(value));
  }
  // Longest first, so an escaped form is not half-replaced by a shorter one.
  return [...forms].filter(Boolean).sort((a, b) => b.length - a.length);
}

const PASSWORD_NAME = /password|şifre|parola/i;

/** Literal secrets, plus any password input value (unknown values too) in DOM and ARIA snapshots. */
export function redactText(text: string, secrets = secretValues()): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join(MASK);
  // Trace DOM snapshots: ["INPUT",{"__playwright_value_":"…","type":"password",…}] (attribute order varies).
  out = out.replace(/"INPUT",\{[^{}]*\}/g, (attrs) =>
    /"type":"password"/.test(attrs) ? attrs.replace(/("__playwright_value_":)"(?:[^"\\]|\\.)*"/, `$1"${MASK}"`) : attrs,
  );
  // Trace actions that fill a password field (by locator: our test ids say "password"), with any value: the
  // action params, its log line and its title. Lines of one action share a callId.
  const calls = new Set<string>();
  for (const m of out.matchAll(/"callId":"([^"]+)"[^\n]*"(?:selector|locator|subtitle)":"(?:[^"\\\n]|\\.)*?password/gi)) {
    if (/"method":"(?:fill|pw:api)"/.test(m[0]) || /"title":"Fill /.test(m[0])) calls.add(m[1]!);
  }
  if (calls.size) {
    out = out.replace(/^.*"callId":"([^"]+)".*$/gm, (line, id: string) => !calls.has(id) ? line : line
      .replace(/("value":)"(?:[^"\\]|\\.)*"/g, `$1"${MASK}"`)
      .replace(/(Fill \\")(?:[^"\\]|\\[^"])*(\\")/g, `$1${MASK}$2`)
      .replace(/(fill\(\\")(?:[^"\\]|\\[^"])*(\\"\))/g, `$1${MASK}$2`));
  }
  // ARIA snapshots (error-context.md, toMatchAriaSnapshot): - textbox "Password": value
  out = out.replace(/^(\s*- textbox "([^"]*)"[^:\n]*): (.+)$/gm, (line, head: string, name: string) =>
    PASSWORD_NAME.test(name) ? `${head}: ${MASK}` : line,
  );
  return out;
}

const isZip = (buf: Buffer) => buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
// Text-like content only; binary (images, video) is left alone.
export const isText = (buf: Buffer) => !buf.subarray(0, 8000).includes(0);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) files.push(...walk(path));
    else if (st.isFile()) files.push(path);
  }
  return files;
}

/** Redacts one file in place (zips are unpacked, redacted entry by entry and packed again). Returns true if changed. */
export function redactFile(path: string, secrets = secretValues()): boolean {
  const buf = readFileSync(path);
  if (isZip(buf)) {
    const tmp = mkdtempSync(join(tmpdir(), "e2e-redact-"));
    try {
      execFileSync("unzip", ["-q", "-o", path, "-d", tmp]);
      let changed = false;
      for (const f of walk(tmp)) changed = redactFile(f, secrets) || changed;
      if (!changed) return false;
      rmSync(path);
      execFileSync("zip", ["-q", "-r", "-X", resolve(path), "."], { cwd: tmp });
      return true;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!isText(buf)) return false;
  const text = buf.toString("utf8");
  const out = redactText(text, secrets);
  if (out === text) return false;
  writeFileSync(path, out);
  return true;
}

export function redactDir(dir: string, secrets = secretValues()): number {
  let changed = 0;
  let files: string[];
  try { files = walk(dir); } catch { return 0; }
  for (const f of files) if (redactFile(f, secrets)) changed++;
  return changed;
}

if (isMain(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error("usage: tsx setup/redact.ts <dir> [<dir> ...]"); process.exit(2); }
  const secrets = secretValues();
  if (!secrets.length) console.log("[redact] E2E_USER_PASSWORD is not set: masking password inputs only.");
  for (const d of dirs) console.log(`[redact] ${d}: ${redactDir(d, secrets)} file(s) masked`);
}
