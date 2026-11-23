#!/usr/bin/env node
// Picks the Playwright tests for a change: every @smoke test plus the specs related to the changed files.
//
//   node scripts/select-specs.mjs [<base ref>]        (default origin/main; run inside e2e/ or the repo root)
//
// Prints a summary and, in GitHub Actions, writes `mode` (full | selected) and `grep` to $GITHUB_OUTPUT.
// Locally: npx playwright test --grep "$(node scripts/select-specs.mjs --grep-only)"
//
// Rules (first match wins per file; one "full" file makes the whole run full):
// - e2e/tests/**.spec.ts                → that spec.
// - other e2e/**.ts (pages, api, data)  → the specs that import it, directly or through other e2e modules.
// - e2e/setup, e2e/fixtures, playwright.config, package files, vite/tsconfig, the app's Supabase client → full.
// - supabase/migrations/*.sql           → every spec of each area the SQL mentions; no known area → full.
// - src/**                              → the area of the path (AREAS below); src/test and generated types → none.
// - anything else (docs, workflows…)    → nothing beyond @smoke.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(E2E, "..");

/** Spec groups by product area (paths relative to e2e/tests). */
export const AREAS = {
  requests: ["ui/event-requests", "ui/event-request-types", "ui/my-requests", "api/event-requests", "api/event-request-types", "ui/calendar-smoke"],
  registrations: ["ui/registrations", "api/registrations", "ui/calendar-smoke"],
  events: ["ui/calendar-smoke", "ui/event-status-dashboard", "ui/event-time-picker", "ui/recurring-events", "api/recurring-events", "ui/registrations"],
  recurring: ["ui/recurring-events", "api/recurring-events"],
  recycle: ["api/recycle-bin", "ui/deactivate-delete", "ui/calendar-smoke", "api/event-requests"],
  users: ["ui/users-isolation", "ui/user-details", "ui/deactivate-delete", "ui/approvals", "ui/pending", "ui/role-branch", "ui/history", "ui/account-deletion", "api/permissions"],
  privacy: ["ui/privacy", "api/privacy", "ui/account-deletion", "ui/auth"],
  auth: ["ui/auth", "ui/pending", "ui/language", "api/bundle-secrets"],
  layout: ["ui/dashboard-layout", "ui/accessibility", "ui/language"],
  dashboard: ["ui/dashboard-layout", "ui/event-status-dashboard"],
  i18n: ["ui/language", "ui/accessibility"],
};

/** src/ path patterns → areas. Checked in order; the first match wins. */
const SRC_RULES = [
  [/^src\/test\/|^src\/integrations\/supabase\/types\.ts$|^src\/routeTree\.gen\.ts$/, []],
  [/^src\/integrations\/supabase\/client|^src\/lib\/supabase/, "full"],
  [/requests?[-./]|\/requests\/|my-requests/i, ["requests"]],
  [/registration/i, ["registrations"]],
  [/series|recurr/i, ["recurring", "events"]],
  [/recycle|delete-event|event-cleanup|cleanup/i, ["recycle"]],
  [/privacy|consent|AccountDeletion|require-member/i, ["privacy"]],
  [/routes\/_app\/profile/, ["privacy", "users", "i18n"]],
  [/delete-user|members|users|user-|DeleteUser|approvals|pending|history|role/i, ["users"]],
  [/routes\/auth|lib\/auth|reset-password|PasswordInput/i, ["auth"]],
  [/routes\/_app\/dashboard|Dashboard/i, ["dashboard"]],
  [/\/events?\/|events?[-.]|calendar|time-options|TimeSelect|DateTime/i, ["events"]],
  [/locales\/|lib\/i18n/, ["i18n"]],
  [/routes\/_app\/route\.tsx|components\/app\/(nav|Logo|Sidebar)|components\/ui\/|styles\.css/, ["layout"]],
];

/** Migration objects (names of the functions, tables, policies' tables and buckets it creates or changes) → areas. */
const SQL_RULES = [
  [/event_request/i, ["requests"]],
  [/registration|waitlist|attendance/i, ["registrations"]],
  [/series/i, ["recurring"]],
  [/^(events|event_media|event-media|(create|update|cancel|delete|validate)_event\w*|\w*_event_media|can_(view|manage)_event\w*)$/i, ["events"]],
  [/recycle|purge|restore_|permanent_delete|deletion_job/i, ["recycle"]],
  [/privacy|consent/i, ["privacy"]],
  [/^(profiles|user_roles|regions|branches)$|set_user_|account_deletion|audit|handle_new_user|delete_user|user_purge/i, ["users"]],
];

/** What a migration defines or changes: CREATE/ALTER/DROP of functions and tables, policies' tables, bucket ids. */
function migrationObjects(sql) {
  const names = new Set();
  const patterns = [
    /(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:FUNCTION|TABLE|VIEW|TRIGGER|TYPE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:public\.|storage\.)?"?(\w+)/gi,
    /(?:CREATE|ALTER|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?[^"]+?"?\s+ON\s+(?:public\.|storage\.)?(\w+)/gi,
    /INSERT\s+INTO\s+storage\.buckets[\s\S]*?VALUES\s*\(\s*'([\w-]+)'/gi,
  ];
  for (const re of patterns) for (const m of sql.matchAll(re)) names.add(m[1]);
  return [...names];
}

const FULL_PATHS = /^(e2e\/setup\/|e2e\/fixtures\/|e2e\/playwright\.config\.ts$|e2e\/package(-lock)?\.json$|e2e\/tsconfig\.json$|package\.json$|bun\.lockb?$|vite\.config|tsconfig)/;

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

function changedFiles(base) {
  const mergeBase = sh("git", ["merge-base", base, "HEAD"]);
  const committed = sh("git", ["diff", "--name-only", `${mergeBase}...HEAD`]);
  const local = process.env.CI ? "" : sh("git", ["diff", "--name-only", "HEAD"]);
  return [...new Set(`${committed}\n${local}`.split("\n").filter(Boolean))];
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Reverse import graph of e2e/**.ts (relative imports only). */
function importers() {
  const reverse = new Map();
  for (const file of walk(E2E)) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      let target = resolve(dirname(file), spec);
      if (!target.endsWith(".ts")) target += ".ts";
      if (!reverse.has(target)) reverse.set(target, new Set());
      reverse.get(target).add(file);
    }
  }
  return reverse;
}

function specsImporting(changed, reverse) {
  const seen = new Set(), specs = new Set(), queue = [resolve(ROOT, changed)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".spec.ts")) specs.add(relative(join(E2E, "tests"), file).replace(/\.spec\.ts$/, ""));
    for (const next of reverse.get(file) ?? []) queue.push(next);
  }
  return [...specs];
}

export function select(files) {
  const specs = new Set(), reasons = [];
  let full = false, reverse;
  const add = (file, list, why) => { list.forEach((s) => specs.add(s)); reasons.push(`${file} → ${why}`); };
  const areas = (file, names) => add(file, names.flatMap((a) => AREAS[a]), `area ${names.join(", ")}`);
  for (const file of files) {
    if (FULL_PATHS.test(file)) { full = true; reasons.push(`${file} → full (test infrastructure / build)`); continue; }
    if (/^e2e\/tests\/.+\.spec\.ts$/.test(file)) {
      if (existsSync(join(ROOT, file))) add(file, [file.replace(/^e2e\/tests\//, "").replace(/\.spec\.ts$/, "")], "itself");
      continue;
    }
    if (/^e2e\/.+\.ts$/.test(file)) {
      reverse ??= importers();
      add(file, specsImporting(file, reverse), "specs importing it");
      continue;
    }
    if (/^supabase\/migrations\/.+\.sql$/.test(file)) {
      const sql = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : "";
      const objects = migrationObjects(sql);
      const hit = [...new Set(SQL_RULES.filter(([re]) => objects.some((o) => re.test(o))).flatMap(([, a]) => a))];
      if (hit.length) areas(file, hit); else { full = true; reasons.push(`${file} → full (migration with no known area)`); }
      continue;
    }
    if (/^src\//.test(file)) {
      const rule = SRC_RULES.find(([re]) => re.test(file));
      if (!rule) { reasons.push(`${file} → @smoke only (no area)`); continue; }
      if (rule[1] === "full") { full = true; reasons.push(`${file} → full`); continue; }
      if (rule[1].length) areas(file, rule[1]); else reasons.push(`${file} → none (unit tests / generated)`);
      continue;
    }
  }
  const escaped = [...specs].sort().map((s) => `${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\.spec\\.ts`);
  // Playwright matches --grep against "<project> <file> <describe…> <title> <tags>", so a file path selects its tests.
  const grep = ["@smoke", ...escaped].join("|");
  return { mode: full ? "full" : "selected", grep, specs: [...specs].sort(), reasons };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const grepOnly = args.includes("--grep-only");
  const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
  const result = select(changedFiles(base));
  if (grepOnly) { console.log(result.grep); process.exit(0); }
  const lines = [
    `Mode: ${result.mode === "full" ? "full suite" : "@smoke + related specs"}`,
    ...(result.mode === "selected" ? [`Specs (${result.specs.length}): ${result.specs.join(", ") || "none"}`] : []),
    "Why:", ...result.reasons.map((r) => `  ${r}`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\ngrep=${result.grep}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### E2E selection\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  }
}
