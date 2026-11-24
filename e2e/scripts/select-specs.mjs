#!/usr/bin/env node
// Picks the Playwright tests for a change: every @smoke test plus the specs related to the changed files.
//
//   node scripts/select-specs.mjs [<base ref>]        (default origin/main; run inside e2e/ or the repo root)
//
// Prints a summary and, in GitHub Actions, writes `mode` (always "selected"), `grep`, `specs`, `tests` and `minutes`
// (estimated Actions minutes) to $GITHUB_OUTPUT.
// Locally: npx playwright test --grep "$(node scripts/select-specs.mjs --grep-only)"
//
// A pull request never gets the full suite from this script: only the "full-ci" label runs everything.
// Rules (first match wins per file):
// - e2e/tests/**.spec.ts                → that spec.
// - any other e2e/**.ts (pages, api, data, fixtures, setup, teardown, helpers) → the specs that import it, directly or
//   through other e2e modules (not through fixtures/setup, which every spec imports). A file no spec imports (playwright.config, teardown, migrate…) → nothing beyond @smoke.
// - supabase/migrations/*.sql           → every spec of each area the SQL mentions; no known area → @smoke only.
// - src/**                              → the area of the path (AREAS below); src/test and generated types → none.
// - package files, vite/tsconfig, the app's Supabase client, migrations with no known area → @smoke only, with a
//   note suggesting the full-ci label.
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
  events: ["ui/calendar-smoke", "ui/event-status-dashboard", "ui/event-time-picker", "ui/recurring-events", "api/recurring-events", "ui/registrations", "api/image-copies"],
  recurring: ["ui/recurring-events", "api/recurring-events"],
  recycle: ["api/recycle-bin", "ui/deactivate-delete", "ui/calendar-smoke", "api/event-requests", "api/image-copies"],
  users: ["ui/users-isolation", "ui/user-details", "ui/deactivate-delete", "ui/approvals", "ui/pending", "ui/role-branch", "ui/history", "ui/account-deletion", "api/permissions"],
  privacy: ["ui/privacy", "api/privacy", "ui/account-deletion", "ui/auth"],
  auth: ["ui/auth", "ui/onboarding", "ui/pending", "ui/language", "api/bundle-secrets"],
  layout: ["ui/dashboard-layout", "ui/accessibility", "ui/language"],
  dashboard: ["ui/dashboard-layout", "ui/onboarding", "ui/event-status-dashboard"],
  i18n: ["ui/language", "ui/accessibility"],
  roles: ["api/roles", "ui/public-events", "ui/followers", "ui/onboarding", "ui/national-coordinator", "ui/branch-map", "api/permissions", "ui/users-isolation", "ui/accessibility"],
  tasks: ["api/tasks", "ui/tasks", "ui/followers", "ui/notifications"],
  meetings: ["api/meetings", "ui/meetings", "ui/followers", "ui/notifications"],
  public: ["ui/landing", "ui/guest-registration", "ui/subscribers", "ui/past-events", "ui/attendees", "ui/event-tba-updates", "ui/public-events"],
};

/** src/ path patterns → areas. Checked in order; the first match wins. */
const SRC_RULES = [
  [/^src\/test\/|^src\/integrations\/supabase\/types\.ts$|^src\/routeTree\.gen\.ts$/, []],
  [/^src\/integrations\/supabase\/client|^src\/lib\/supabase/, "full"],
  [/components\/landing\/|lib\/landing|image-variants|ResponsiveImage|lib\/email\/|public-guest|components\/public\/(Guest|Subscribe|form-protection|GuestLink|SubscriberLink)|past-events|PastEvent|event-videos|EventVideos|youtube|attendee|Attendee|announce|Announce|event-emails|video-posters|routes\/index\.tsx|routes\/(e|updates)\.|routes\/privacy_\.attendees|routes\/api\/public\/unsubscribe|attendee-privacy/i, ["public"]],
  [/components\/tasks\/|routes\/_app\/tasks|lib\/tasks|task-reminders|EventLinkedTasks/i, ["tasks"]],
  [/components\/meetings\/|routes\/_app\/meetings|lib\/meetings/i, ["meetings"]],
  [/work-requests|WorkRequest|work-scopes|components\/work\/|notifications|Notifications|TaskReminderPreferences/i, ["tasks", "meetings"]],
  [/public-events|routes\/events\.|routes\/api\/ics|followed-branches|FollowedBranches|volunteer-applications|VolunteerApplications|national|regions|MfaGate|RoleDashboards|branch-map|BranchMap|geocode|\/roles\.ts|components\/app\/nav|components\/public\//i, ["roles"]],
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
  [/guest|subscriber|announce|email_capture|capture_email|claim_email|finish_email|enqueue_email|email_event|landing|past_event|event_video|ics_|rate_hit|rate_limits/i, ["public"]],
  [/^(tasks?_\w*|\w*_tasks?(_\w+)?|meetings?_\w*|\w*_meetings?(_\w+)?|meeting-files|agenda\w*|\w*_agenda_\w*|notifications?\w*|\w*_notifications?\w*|notify|email_outbox|work_\w*|\w*_work_\w*|request_(target|scope)\w*|in_work_scope|scope_people|is_active_person|is_branch_member|json_uuid_array)$/i, ["tasks", "meetings"]],
  [/event_request/i, ["requests"]],
  [/registration|waitlist|attendance/i, ["registrations"]],
  [/series/i, ["recurring"]],
  [/^(events|event_media|event-media|(create|update|cancel|delete|validate)_event\w*|\w*_event_media|can_(view|manage)_event\w*)$/i, ["events"]],
  [/recycle|purge|restore_|permanent_delete|deletion_job/i, ["recycle"]],
  [/privacy|consent/i, ["privacy"]],
  [/follow|volunteer_application|public_event|get_public|national|_nc|nc_|region|branch|is_member|is_follower|session_ok|app_role/i, ["roles"]],
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

/** Build-wide files: nothing imports them in e2e, so they select only @smoke; the summary suggests full-ci. */
const BUILD_PATHS = /^(e2e\/package(-lock)?\.json$|e2e\/tsconfig\.json$|package\.json$|bun\.lockb?$|vite\.config|tsconfig)/;

/**
 * Actions minutes, measured on the local stack (3 shards): about 2.5 minutes of setup per shard (dependencies, stack,
 * browsers), about 24 minutes of tests for the full suite, and about 1 minute each for plan and report (GitHub bills
 * every job at least one minute).
 */
const MINUTES = { setupPerShard: 2.5, shards: 3, fullTests: 24, planAndReport: 2 };

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

/** Modules every spec imports (fixtures, setup): a change to one of them selects its importers, but a helper's change
 * is not followed through them, or every helper would select every spec. */
const HUBS = [join(E2E, "fixtures") + "/", join(E2E, "setup") + "/"];

function specsImporting(changed, reverse) {
  const start = resolve(ROOT, changed);
  const seen = new Set(), specs = new Set(), queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file !== start && HUBS.some((hub) => file.startsWith(hub))) continue;
    if (file.endsWith(".spec.ts")) specs.add(relative(join(E2E, "tests"), file).replace(/\.spec\.ts$/, ""));
    for (const next of reverse.get(file) ?? []) queue.push(next);
  }
  return [...specs];
}

/** Test titles per spec (paths relative to e2e/tests, without .spec.ts), with how many carry @smoke. */
function testCounts() {
  const counts = new Map();
  for (const file of walk(join(E2E, "tests"))) {
    if (!file.endsWith(".spec.ts")) continue;
    const text = readFileSync(file, "utf8");
    const tests = (text.match(/^\s*test(?:\.(?:skip|fixme|fail|only))?\(\s*[`"']/gm) ?? []).length;
    const smoke = (text.match(/tag:\s*["']@smoke["']/g) ?? []).length;
    // UI specs run in two projects (desktop, mobile); API specs in one.
    const weight = file.includes("/ui/") ? 2 : 1;
    counts.set(relative(join(E2E, "tests"), file).replace(/\.spec\.ts$/, ""), { tests, smoke, weight });
  }
  return counts;
}

/** Selected test runs (tests × projects) and estimated Actions minutes for these specs plus every @smoke test. */
export function estimate(specs, full = false) {
  const counts = testCounts();
  let all = 0, selected = 0;
  for (const [spec, { tests, smoke, weight }] of counts) {
    all += tests * weight;
    selected += (full || specs.includes(spec) ? tests : smoke) * weight;
  }
  const minutes = Math.ceil(
    MINUTES.shards * MINUTES.setupPerShard + MINUTES.planAndReport + (all ? (MINUTES.fullTests * selected) / all : 0),
  );
  return { tests: selected, minutes };
}

export function select(files) {
  const specs = new Set(), reasons = [];
  let suggestFull = false, reverse;
  const add = (file, list, why) => { list.forEach((s) => specs.add(s)); reasons.push(`${file} → ${why}`); };
  const areas = (file, names) => add(file, names.flatMap((a) => AREAS[a]), `area ${names.join(", ")}`);
  for (const file of files) {
    if (BUILD_PATHS.test(file)) { suggestFull = true; reasons.push(`${file} → @smoke only (build file; add full-ci for everything)`); continue; }
    if (/^e2e\/tests\/.+\.spec\.ts$/.test(file)) {
      if (existsSync(join(ROOT, file))) add(file, [file.replace(/^e2e\/tests\//, "").replace(/\.spec\.ts$/, "")], "itself");
      continue;
    }
    if (/^e2e\/.+\.ts$/.test(file)) {
      reverse ??= importers();
      const importing = specsImporting(file, reverse);
      add(file, importing, importing.length ? `specs importing it (${importing.length})` : "no spec imports it: @smoke only");
      continue;
    }
    if (/^supabase\/migrations\/.+\.sql$/.test(file)) {
      const sql = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : "";
      const objects = migrationObjects(sql);
      const hit = [...new Set(SQL_RULES.filter(([re]) => objects.some((o) => re.test(o))).flatMap(([, a]) => a))];
      if (hit.length) areas(file, hit); else { suggestFull = true; reasons.push(`${file} → @smoke only (migration with no known area; add full-ci for everything)`); }
      continue;
    }
    if (/^src\//.test(file)) {
      const rule = SRC_RULES.find(([re]) => re.test(file));
      if (!rule) { reasons.push(`${file} → @smoke only (no area)`); continue; }
      if (rule[1] === "full") { suggestFull = true; reasons.push(`${file} → @smoke only (Supabase client; add full-ci for everything)`); continue; }
      if (rule[1].length) areas(file, rule[1]); else reasons.push(`${file} → none (unit tests / generated)`);
      continue;
    }
  }
  const escaped = [...specs].sort().map((s) => `${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\.spec\\.ts`);
  // Playwright matches --grep against "<project> <file> <describe…> <title> <tags>", so a file path selects its tests.
  const grep = ["@smoke", ...escaped].join("|");
  const list = [...specs].sort();
  return { mode: "selected", grep, specs: list, reasons, suggestFull, ...estimate(list) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const grepOnly = args.includes("--grep-only");
  if (args.includes("--estimate-full")) {
    const full = estimate([], true);
    console.log(`Estimate: ${full.tests} test runs, about ${full.minutes} Actions minutes`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tests=${full.tests}\nminutes=${full.minutes}\n`);
    process.exit(0);
  }
  const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
  const result = select(changedFiles(base));
  if (grepOnly) { console.log(result.grep); process.exit(0); }
  const lines = [
    "Mode: @smoke + related specs",
    `Specs (${result.specs.length}): ${result.specs.join(", ") || "none"}`,
    `Estimate: ${result.tests} test runs (tests × projects), about ${result.minutes} Actions minutes`,
    ...(result.suggestFull ? ["Note: some changes affect everything; add the full-ci label for the full suite."] : []),
    "Why:", ...result.reasons.map((r) => `  ${r}`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\ngrep=${result.grep}\nspecs=${result.specs.length}\ntests=${result.tests}\nminutes=${result.minutes}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### E2E selection\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  }
}
