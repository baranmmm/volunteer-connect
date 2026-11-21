// Helper for .github/workflows/prod-db-migrate.yml. Never prints connection details or the password.
//
//   node prod-db-migrate.mjs prepare            validate + mask the connection, export DB_URL to later steps
//   node prod-db-migrate.mjs run "<title>" ...  run `supabase <args>` against DB_URL, sanitize the output and
//                                               append it to the job summary
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const QA_REF = "impdbvwsaancutwlrmac";

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

/** Every form of the connection details that could show up in output. Longest first, so replacements nest. */
function sensitive(url) {
  const u = new URL(url);
  const values = [url, u.password, u.username, u.host, u.hostname];
  for (const v of [u.password, u.username]) {
    try {
      values.push(decodeURIComponent(v));
    } catch {
      /* not encoded */
    }
  }
  return [...new Set(values.filter((v) => v && v.length >= 4))].sort((a, b) => b.length - a.length);
}

function prepare() {
  const raw = process.env.POOLER_URL?.trim();
  const password = process.env.DB_PASSWORD ?? "";
  if (!raw || !password)
    fail("PROD_DB_POOLER_URL and PROD_DB_PASSWORD must be set in the 'production' environment.");

  // Mask first, before anything below can print a value.
  console.log(`::add-mask::${raw}`);
  console.log(`::add-mask::${password}`);
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail("PROD_DB_POOLER_URL is not a valid URL.");
  }
  const url = `${u.protocol}//${u.username}:${encodeURIComponent(password)}@${u.host}${u.pathname}${u.search}`;
  for (const v of sensitive(url)) console.log(`::add-mask::${v}`);

  // Guard: this workflow must never target the QA project.
  if (raw.includes(QA_REF) || decodeURIComponent(u.username).includes(QA_REF)) {
    fail(
      "PROD_DB_POOLER_URL points at the QA project. Aborting: this workflow is for production only.",
    );
  }
  if (u.password)
    fail("PROD_DB_POOLER_URL must not contain the password; it comes from PROD_DB_PASSWORD.");
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail("PROD_DB_POOLER_URL must be a postgresql:// URL.");
  if (u.hostname.startsWith("db.") || !u.hostname.endsWith(".pooler.supabase.com")) {
    fail(
      "PROD_DB_POOLER_URL must be the Session pooler URL (*.pooler.supabase.com), not the direct connection.",
    );
  }

  appendFileSync(process.env.GITHUB_ENV, `DB_URL=${url}\n`);
  console.log("Connection validated and masked.");
}

function run(title, args) {
  const url = process.env.DB_URL;
  if (!url) fail("DB_URL is missing; the prepare step must run first.");
  const r = spawnSync("supabase", [...args, "--output-format", "text", `--remote=${url}`], {
    cwd: process.env.GITHUB_WORKSPACE,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  for (const v of sensitive(url)) out = out.split(v).join("***");
  out = out.replaceAll("```", "'''").trim();

  console.log(out);
  const status = r.error ? `failed to start (${r.error.code ?? "error"})` : `exit ${r.status}`;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ${title}\n\n\`supabase ${args.join(" ")}\`: ${status}\n\n\`\`\`text\n${out}\n\`\`\`\n\n`,
  );
  if (r.error || r.status !== 0) fail(`${title} failed (${status}).`);
}

const [command, title, ...args] = process.argv.slice(2);
if (command === "prepare") prepare();
else if (command === "run" && title && args.length) run(title, args);
else fail("usage: prod-db-migrate.mjs prepare | run <title> <supabase args...>");
