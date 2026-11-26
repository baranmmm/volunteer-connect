import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// The pre-launch reset (scripts/prelaunch/reset.sql) against every migration in PGlite, on a production-like database:
// the dotted National Coordinator, the 15 imported past events with their photos and the 6 highlight videos stay;
// every other account and all user-generated data go. Also: the second run changes nothing, the guards abort with
// nothing changed, an empty database is a no-op (as on every fresh stack once the script is a migration), and the
// read-only report / storage list agree with the reset.
// PGlite's auth and storage schemas are stubs: the auth.* tables the scripts touch are created here with the same
// ON DELETE CASCADE to auth.users as Supabase; Storage's protect_objects_delete trigger is not in the stub (the
// dashboard deletion is simulated with a plain DELETE). The real schemas are covered by a local-stack run of the
// three scripts (seed, report, reset twice, report, storage list in one transaction ending in ROLLBACK).
const RESET = readFileSync("scripts/prelaunch/reset.sql", "utf8");
const REPORT = readFileSync("scripts/prelaunch/report.sql", "utf8");
const STORAGE_LIST = readFileSync("scripts/prelaunch/storage-delete-list.sql", "utf8");

const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  b2: id(3),
  bGone: id(4),
  nc: id(10),
  nc2: id(11),
  rd: id(12),
  bm: id(13),
  vol: id(14),
  vol2: id(15),
  fol: id(16),
  pend: id(17),
};
type Row = Record<string, unknown>;
type ReportRow = { section: string; name: string; detail: string; n: number | null };

async function q<T = Row>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function one<T = unknown>(sql: string, params: unknown[] = []) {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  return row?.v as T;
}
async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}
async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal','aal1',true)",
    [user ?? ""],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function reset() {
  const notices: string[] = [];
  await db.exec(RESET, { onNotice: (n) => notices.push(n.message ?? "") });
  return notices;
}
async function resetFails(message: string) {
  await db.exec("SAVEPOINT guard");
  try {
    await expect(db.exec(RESET)).rejects.toThrow(message);
  } finally {
    await db.exec("ROLLBACK TO SAVEPOINT guard");
  }
}
async function report() {
  return (await q<ReportRow>(REPORT)).map((r) => ({
    ...r,
    n: r.n === null ? null : Number(r.n),
  }));
}
const storageList = () => q<{ bucket_id: string; name: string }>(STORAGE_LIST);

/** Every table of public, auth and storage with a digest of its rows: equal snapshots = nothing changed. */
async function snapshot() {
  const tables = await q<{ t: string }>(
    `SELECT format('%I.%I', n.nspname, c.relname) t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public','auth','storage') AND c.relkind = 'r' ORDER BY 1`,
  );
  const out: Record<string, string> = {};
  for (const { t } of tables)
    out[t] = await one<string>(
      `SELECT count(*) || ':' || md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) v FROM ${t} x`,
    );
  return out;
}
const count = (table: string, where = "true") =>
  one<number>(`SELECT count(*)::int v FROM ${table} WHERE ${where}`);

// Tables that keep rows after the reset; every other public table must be empty.
const KEPT_TABLES = [
  "regions",
  "branches",
  "postcode_geocodes",
  "profiles",
  "user_roles",
  "user_followed_branches",
  "consent_preferences",
  "notification_preferences",
  "privacy_notice_acceptances",
  "push_subscriptions",
  "events",
  "event_media",
  "event_videos",
];

beforeAll(async () => {
  await initializeRecycleDatabase(db);
}, 60000);
afterAll(async () => db.close());

// Each reset runs every statement on the whole seeded database: under a full parallel Vitest run that can pass the
// default 5 s.
describe(
  "a database without keep data (fresh stacks, CI, QA, this fixture)",
  { timeout: 30000 },
  () => {
    it("is a no-op with a notice, also without the auth tables it would otherwise touch", () =>
      tx(async () => {
        // Runs before the auth.* stubs exist: the no-op path reads only auth.users and public tables, so the script is
        // safe as a migration in the PGlite fixture too. An undotted NC (like the e2e seed's) is not keep data.
        await db.exec(`INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
        ('${id(90)}', 'nc@fresh.test', jsonb_build_object('privacy_notice_version','1.6'));
        UPDATE public.user_roles SET role = 'national_coordinator' WHERE user_id = '${id(90)}';
        UPDATE public.profiles SET status = 'active' WHERE id = '${id(90)}';`);
        const before = await snapshot();
        const notices = await reset();
        expect(notices.join("\n")).toContain("not the production database, nothing changed");
        expect(await snapshot()).toEqual(before);
      }));

    it("leftover e2e channel videos (no dotted NC, no imported events) are still a no-op, not an abort", () =>
      tx(async () => {
        // landing.spec creates channel videos (event_id NULL, created_by NULL); some can be left on QA or a long-lived
        // local stack. They match the video keep rule but must not make the migration fail there.
        await db.exec(
          `INSERT INTO public.event_videos(youtube_id, title) VALUES ('dQw4w9WgXcQ', 'Leftover e2e video');`,
        );
        const before = await snapshot();
        const notices = await reset();
        expect(notices.join("\n")).toContain("not the production database, nothing changed");
        expect(await snapshot()).toEqual(before);
      }));
  },
);

describe("the production-like database", { timeout: 30000 }, () => {
  let keptEvents: string[] = [];
  let keptVideoEvents: string[] = [];
  let keptMedia: string[] = [];
  let keptVideos: string[] = [];
  let deleteObjects: string[] = [];
  let ncSettings: Record<string, number> = {};

  beforeAll(async () => {
    // auth.* stubs with Supabase's cascades (PGlite's fixture only has auth.users).
    await db.exec(`
      CREATE TABLE auth.identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE, provider text);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE);
      CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE, factor_type text);
      CREATE TABLE auth.one_time_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE);
      CREATE TABLE auth.refresh_tokens(id bigserial PRIMARY KEY, user_id varchar(255), session_id uuid REFERENCES auth.sessions ON DELETE CASCADE);
      CREATE TABLE auth.flow_state(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
      CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload json);`);

    await db.exec("BEGIN");
    const people = [ids.nc, ids.nc2, ids.rd, ids.bm, ids.vol, ids.vol2, ids.pend];
    const email: Record<string, string> = {
      [ids.nc]: "first.last@dialoguesociety.test",
      [ids.nc2]: "nc@dialoguesociety.test",
      [ids.rd]: "rd@x.test",
      [ids.bm]: "bm@x.test",
      [ids.vol]: "vol@x.test",
      [ids.vol2]: "vol2@x.test",
      [ids.pend]: "pending@x.test",
    };
    await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
      INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}'),
        ('${ids.bGone}','Closed','${ids.region}');
      ${people.map((p) => `INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('${p}', '${email[p]}', jsonb_build_object('full_name','Person ${p.slice(0, 2)}','privacy_notice_version','1.6','branch_id','${ids.b1}'));`).join("\n")}
      INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('${ids.fol}', 'follower@x.test',
        jsonb_build_object('full_name','Follower','privacy_notice_version','1.6','branch_id','${ids.b1}','follower',true,
          'photo_consent',true,'updates_email_consent',true));
      UPDATE profiles SET status='active' WHERE id <> '${ids.pend}' AND id <> '${ids.fol}';
      UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.nc}','${ids.nc2}','${ids.rd}');
      UPDATE user_roles SET role='national_coordinator' WHERE user_id IN ('${ids.nc}','${ids.nc2}');
      UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
      UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm}';
      -- A branch trustee (20261210090000): deleted like every other account.
      UPDATE user_roles SET role='trustee' WHERE user_id='${ids.vol2}';
      INSERT INTO user_followed_branches(user_id, branch_id) VALUES ('${ids.nc}','${ids.b2}');
      INSERT INTO notification_preferences(user_id) VALUES ('${ids.nc}'), ('${ids.vol}');
      INSERT INTO consent_preferences(user_id) VALUES ('${ids.nc}') ON CONFLICT DO NOTHING;
      UPDATE branches SET deleted_at = now(), deleted_by = '${ids.bm}' WHERE id = '${ids.bGone}';
      -- auth rows for everyone; MFA for both NCs.
      INSERT INTO auth.identities(user_id, provider) SELECT id, 'email' FROM auth.users;
      INSERT INTO auth.sessions(id, user_id) SELECT gen_random_uuid(), id FROM auth.users;
      INSERT INTO auth.refresh_tokens(user_id, session_id) SELECT user_id::text, id FROM auth.sessions;
      INSERT INTO auth.refresh_tokens(user_id) VALUES ('${ids.vol}'), (NULL);
      INSERT INTO auth.one_time_tokens(user_id) VALUES ('${ids.nc}'), ('${ids.vol}');
      INSERT INTO auth.flow_state(user_id) VALUES ('${ids.nc}'), ('${ids.vol}'), (NULL);
      INSERT INTO auth.audit_log_entries(payload) VALUES (json_build_object('actor_id','${ids.nc}')), (json_build_object('actor_id','${ids.vol}')), ('{}');
      INSERT INTO auth.mfa_factors(user_id, factor_type) VALUES ('${ids.nc}','totp'), ('${ids.nc2}','totp');`);

    // The 15 imported past events (photos from dialoguesociety.org, one with a second photo uploaded by a volunteer),
    // the channel highlight videos and one video on a kept event; Storage objects incl. image copies and posters.
    await db.exec(`DO $$
      DECLARE _e uuid; _v uuid; i int;
      BEGIN
        PERFORM set_config('app.past_event', 'on', true);
        FOR i IN 1..15 LOOP
          INSERT INTO public.events(title, organizer, category, scope, branch_id, region_id, start_date, past_record, created_by)
          VALUES ('Imported ' || i, 'Dialogue Society', 'dialogue', CASE WHEN i % 2 = 0 THEN 'branch' ELSE 'national' END,
            CASE WHEN i % 2 = 0 THEN '${ids.b1}'::uuid END, CASE WHEN i % 2 = 0 THEN '${ids.region}'::uuid END,
            date '2023-01-01' + i * 7, true, CASE WHEN i = 1 THEN '${ids.bm}'::uuid WHEN i = 2 THEN '${ids.nc}'::uuid END)
          RETURNING id INTO _e;
          INSERT INTO public.event_media(event_id, storage_path, kind, position, in_gallery, source_url, has_variants)
          VALUES (_e, _e || '/photo.jpg', 'image', 0, true, 'https://www.dialoguesociety.org/wp-content/' || i || '.jpg', true);
          INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', _e || '/photo.jpg'),
            ('event-media', _e || '/photo.w640.webp'), ('event-media', _e || '/photo.w1280.webp');
          IF i = 3 THEN
            INSERT INTO public.event_media(event_id, storage_path, kind, position, uploaded_by) VALUES (_e, _e || '/extra.png', 'image', 1, '${ids.vol}');
            INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', _e || '/extra.png');
            _v := gen_random_uuid();
            INSERT INTO public.event_videos(id, event_id, youtube_id, title, thumb_path, created_by)
            VALUES (_v, _e, 'attachedVid', 'On a kept event', 'videos/' || _v || '.jpg', '${ids.vol}');
            INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', 'videos/' || _v || '.jpg');
          END IF;
        END LOOP;
        FOR i IN 1..5 LOOP
          _v := gen_random_uuid();
          INSERT INTO public.event_videos(id, youtube_id, title, thumb_path, position)
          VALUES (_v, 'channel000' || i, 'Highlight ' || i, CASE WHEN i < 5 THEN 'videos/' || _v || '.jpg' END, i);
          IF i < 5 THEN INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', 'videos/' || _v || '.jpg'); END IF;
        END LOOP;
      END $$;`);
    await db.exec("COMMIT");

    keptEvents = (
      await q<{ id: string }>("SELECT id FROM events WHERE past_record ORDER BY id")
    ).map((r) => r.id);
    keptVideoEvents = (
      await q<{ event_id: string }>("SELECT event_id FROM event_videos WHERE event_id IS NOT NULL")
    ).map((r) => r.event_id);
    keptMedia = (await q<{ id: string }>("SELECT id FROM event_media ORDER BY id")).map(
      (r) => r.id,
    );
    keptVideos = (await q<{ id: string }>("SELECT id FROM event_videos ORDER BY id")).map(
      (r) => r.id,
    );

    // Everything else: test data that must go.
    await db.exec("BEGIN");
    await db.exec(`DO $$
      DECLARE _e uuid; _pub uuid; _mem uuid; _s uuid; _m uuid; _a1 uuid; _a2 uuid; _d uuid; _t uuid; _r uuid; _v uuid;
        _ua uuid; _req uuid; _n uuid; _sub uuid; _ms uuid; _mail uuid; _ke uuid; _al uuid; _ph uuid; _mr uuid;
      BEGIN
        -- A past record without an imported photo, and an imported-looking one in the Recycle Bin (both deleted).
        PERFORM set_config('app.past_event', 'on', true);
        INSERT INTO public.events(title, organizer, category, scope, start_date, past_record, created_by)
        VALUES ('Own past event', 'Us', 'dinner', 'national', date '2024-02-02', true, '${ids.vol}') RETURNING id INTO _e;
        INSERT INTO public.event_media(event_id, storage_path, kind, position, in_gallery) VALUES (_e, _e || '/p.jpg', 'image', 0, true);
        INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', _e || '/p.jpg'), ('event-media', _e || '/p.w640.webp');
        INSERT INTO public.events(title, organizer, category, scope, start_date, past_record)
        VALUES ('Binned import', 'Dialogue Society', 'dialogue', 'national', date '2022-02-02', true) RETURNING id INTO _e;
        INSERT INTO public.event_media(event_id, storage_path, kind, position, source_url)
        VALUES (_e, 'deleted/' || _e || '/i.jpg', 'image', 0, 'https://www.dialoguesociety.org/x.jpg');
        UPDATE public.events SET deleted_at = now(), deleted_by = '${ids.nc2}' WHERE id = _e;
        INSERT INTO public.event_deletion_jobs(event_id, requested_by) VALUES (_e, '${ids.nc2}');
        INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', 'deleted/' || _e || '/i.jpg');
        PERFORM set_config('app.past_event', '', true);

        -- A draft, a members event with registrations and a public event with a cover, a guest and a subscriber.
        INSERT INTO public.events(title, organizer, category, scope, branch_id, region_id, created_by)
        VALUES ('Draft', 'BM', 'other', 'branch', '${ids.b1}', '${ids.region}', '${ids.bm}');
        INSERT INTO public.events(title, organizer, category, scope, branch_id, region_id, status, audience, start_at, end_at, location, created_by, capacity)
        VALUES ('Members night', 'BM', 'community', 'branch', '${ids.b1}', '${ids.region}', 'published', 'members',
          now() + interval '7 days', now() + interval '7 days 2 hours', 'Hall', '${ids.bm}', 1) RETURNING id INTO _mem;
        INSERT INTO public.event_registrations(event_id, user_id, status) VALUES (_mem, '${ids.vol}', 'registered'), (_mem, '${ids.vol2}', 'waitlisted');
        INSERT INTO public.events(title, organizer, category, scope, branch_id, region_id, audience, start_at, end_at, location, created_by)
        VALUES ('Open dinner', 'BM', 'dinner', 'branch', '${ids.b1}', '${ids.region}', 'public',
          now() + interval '9 days', now() + interval '9 days 2 hours', 'Hall', '${ids.bm}') RETURNING id INTO _pub;
        INSERT INTO public.event_media(event_id, storage_path, kind, position, uploaded_by) VALUES (_pub, _pub || '/cover.jpg', 'image', 0, '${ids.bm}');
        INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', _pub || '/cover.jpg'), ('event-media', _pub || '/cover.w1280.webp');
        UPDATE public.events SET status = 'published' WHERE id = _pub;
        INSERT INTO public.event_registrations(event_id, guest, show_name, status, places) VALUES (_pub, true, false, 'registered', 2) RETURNING id INTO _r;
        INSERT INTO public.event_guests(registration_id, event_id, full_name, email) VALUES (_r, _pub, 'Guest Person', 'guest@x.test');
        INSERT INTO public.event_registrations(event_id, user_id, status) VALUES (_pub, '${ids.fol}', 'registered');
        INSERT INTO public.subscribers(email, source, branch_id) VALUES ('sub@x.test', 'landing', '${ids.b1}') RETURNING id INTO _sub;
        INSERT INTO public.email_outbox(template, subscriber_id) VALUES ('event_announcement', _sub);
        INSERT INTO public.email_outbox(template, user_id) VALUES ('task_reminder', '${ids.vol}');
        INSERT INTO public.event_announcements(event_id, target, created_by) VALUES (_pub, 'all', '${ids.bm}');
        _v := gen_random_uuid();
        INSERT INTO public.event_videos(id, event_id, youtube_id, thumb_path, created_by) VALUES (_v, _pub, 'pubVideo001', 'videos/' || _v || '.jpg', '${ids.bm}');
        INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', 'videos/' || _v || '.jpg');
        -- A channel video added by a test account: must not survive as created_by NULL.
        _v := gen_random_uuid();
        INSERT INTO public.event_videos(id, youtube_id, thumb_path, created_by) VALUES (_v, 'testChannel', 'videos/' || _v || '.jpg', '${ids.vol}');
        INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', 'videos/' || _v || '.jpg');

        -- A recurring series with its media holder event.
        PERFORM set_config('app.series_op', 'on', true);
        INSERT INTO public.event_series(rule, dtstart_local, duration_minutes, title, organizer, category, scope, branch_id, region_id, created_by)
        VALUES ('FREQ=WEEKLY;COUNT=3', now()::timestamp + interval '14 days', 60, 'Weekly circle', 'BM', 'dialogue', 'branch',
          '${ids.b1}', '${ids.region}', '${ids.bm}') RETURNING id INTO _s;
        INSERT INTO public.events(title, organizer, category, scope, branch_id, region_id, start_at, end_at, location, created_by, series_id, recurrence_key, series_template)
        VALUES ('Weekly circle', 'BM', 'dialogue', 'branch', '${ids.b1}', '${ids.region}', now() + interval '14 days', now() + interval '14 days 1 hour',
          'Hall', '${ids.bm}', _s, NULL, true) RETURNING id INTO _e;
        UPDATE public.event_series SET media_event_id = _e WHERE id = _s;
        INSERT INTO public.events(title, organizer, category, scope, branch_id, region_id, start_at, end_at, location, created_by, series_id, recurrence_key)
        VALUES ('Weekly circle', 'BM', 'dialogue', 'branch', '${ids.b1}', '${ids.region}', now() + interval '14 days', now() + interval '14 days 1 hour',
          'Hall', '${ids.bm}', _s, now()::timestamp + interval '14 days');
        PERFORM set_config('app.series_op', '', true);

        -- A meeting (with its calendar event) in a series, agenda items with a carry-over, a decision, files, invitees.
        INSERT INTO public.meeting_series(freq, occurrence_count, created_by) VALUES ('weekly', 4, '${ids.bm}') RETURNING id INTO _ms;
        INSERT INTO public.meetings(scope, branch_id, region_id, title, starts_at, ends_at, location, created_by, series_id)
        VALUES ('branch', '${ids.b1}', '${ids.region}', 'Branch meeting', now() + interval '3 days', now() + interval '3 days 1 hour', 'Room 1', '${ids.bm}', _ms)
        RETURNING id INTO _m;
        INSERT INTO public.meeting_agenda_items(meeting_id, position, title) VALUES (_m, 0, 'Budget') RETURNING id INTO _a1;
        INSERT INTO public.meeting_agenda_items(meeting_id, position, title) VALUES (_m, 1, 'Budget (carried)') RETURNING id INTO _a2;
        UPDATE public.meeting_agenda_items SET carried_to = _a2 WHERE id = _a1;
        INSERT INTO public.meeting_decisions(meeting_id, agenda_item_id, text, created_by) VALUES (_m, _a1, 'Approve', '${ids.bm}') RETURNING id INTO _d;
        INSERT INTO public.meeting_invitees(meeting_id, user_id, invited_by) VALUES (_m, '${ids.vol}', '${ids.bm}'), (_m, '${ids.nc}', '${ids.bm}');
        INSERT INTO public.meeting_files(meeting_id, kind, storage_path, original_name, created_by) VALUES (_m, 'pdf', _m || '/minutes.pdf', 'minutes.pdf', '${ids.bm}');
        INSERT INTO storage.objects(bucket_id, name) VALUES ('meeting-files', _m || '/minutes.pdf');
        INSERT INTO public.meeting_requests(scope, topic, branch_id, region_id, requester_id, target_id, meeting_id)
        VALUES ('branch', 'Talk about rota', '${ids.b1}', '${ids.region}', '${ids.vol}', '${ids.bm}', _m);

        -- Tasks from the decision, with assignee, note, reminder log and a request.
        INSERT INTO public.tasks(scope, branch_id, region_id, title, created_by, meeting_id, decision_id, event_id)
        VALUES ('branch', '${ids.b1}', '${ids.region}', 'Book the hall', '${ids.bm}', _m, _d, _mem) RETURNING id INTO _t;
        INSERT INTO public.task_assignees(task_id, user_id, assigned_by) VALUES (_t, '${ids.vol}', '${ids.bm}');
        INSERT INTO public.task_notes(task_id, body, author_id) VALUES (_t, 'Called them', '${ids.vol}');
        INSERT INTO public.task_reminder_log(task_id, user_id, day, kind) VALUES (_t, '${ids.vol}', current_date, 'before');
        INSERT INTO public.task_requests(scope, title, requester_id, target_id, task_id, branch_id, region_id)
        VALUES ('branch', 'Need help', '${ids.vol}', '${ids.bm}', _t, '${ids.b1}', '${ids.region}');

        -- Notifications (also the kept NC's own), digest log, requests of every kind, audit and log rows.
        INSERT INTO public.notifications(user_id, kind, entity_type, entity_id, title, link, actor_id)
        VALUES ('${ids.nc}', 'meeting_invited', 'meeting', _m, 'Branch meeting', '/meetings/' || _m, '${ids.bm}') RETURNING id INTO _n;
        INSERT INTO public.notifications(user_id, kind, entity_type, entity_id, title, link, digest_id, email_digest, email_digested_at)
        VALUES ('${ids.vol}', 'task_status_changed', 'task', _t, 'Book the hall', '/tasks/' || _t, _n, true, now());
        -- A daily summary email (the log points at it) and an immediate notice email.
        INSERT INTO public.email_outbox(template, user_id, payload) VALUES ('daily_digest', '${ids.vol}', '{"count":1}') RETURNING id INTO _mail;
        INSERT INTO public.notification_digest_log(user_id, day, notification_id, email_id) VALUES ('${ids.vol}', current_date, _n, _mail);
        INSERT INTO public.notification_digest_log(user_id, day, notification_id) VALUES ('${ids.nc}', current_date, _n);
        INSERT INTO public.email_outbox(template, user_id, notification_id, payload) VALUES ('notice', '${ids.nc}', _n, '{"type":"meeting"}');
        INSERT INTO public.event_requests(requester_id, scope, branch_id, region_id, title, proposed_start, proposed_end, last_edited_by)
        VALUES ('${ids.vol}', 'branch', '${ids.b1}', '${ids.region}', 'Iftar', now() + interval '20 days', now() + interval '20 days 2 hours', '${ids.vol}')
        RETURNING id INTO _req;
        INSERT INTO public.event_request_media(request_id, storage_path, kind, uploaded_by) VALUES (_req, _req || '/flyer.pdf', 'pdf', '${ids.vol}');
        INSERT INTO storage.objects(bucket_id, name) VALUES ('event-request-files', _req || '/flyer.pdf');
        INSERT INTO public.volunteer_applications(user_id, branch_id, motivation) VALUES ('${ids.fol}', '${ids.b1}', 'I want to help');
        INSERT INTO public.user_audit_log(actor_id, target_id, action) VALUES ('${ids.bm}', '${ids.vol2}', 'deletion_requested') RETURNING id INTO _ua;
        INSERT INTO public.user_audit_log(actor_id, target_id, action) VALUES ('${ids.nc}', '${ids.nc2}', 'role_change');
        INSERT INTO public.account_deletion_requests(user_id, deletion_audit_id) VALUES ('${ids.vol2}', _ua);
        INSERT INTO public.user_deletion_state(target_id, deletion_audit_id, previous_status, self_requested, operation, operation_actor)
        VALUES ('${ids.vol2}', _ua, 'active', true, 'deleting', '${ids.bm}');
        INSERT INTO public.recycle_bin_audit_log(item_type, item_id, action, actor_id) VALUES ('event', _e, 'delete', '${ids.nc}');
        INSERT INTO public.event_audit_log(actor_id, event_id, scope, region_id, branch_id) VALUES ('${ids.bm}', _mem, 'branch', '${ids.region}', '${ids.b1}');
        INSERT INTO public.event_cleanup_audit(outcome) VALUES ('ok');
        INSERT INTO public.public_rate_limits(bucket, window_start, hits) VALUES ('guest:abc', now(), 3);
        INSERT INTO public.privacy_notice_acceptances(user_id, notice_version) VALUES (NULL, '1.2');
        -- Push devices (20261212090000): the kept NC's own stays, the volunteer's goes; a queued push for each.
        INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
        VALUES ('${ids.nc}', 'https://push.example.test/nc', repeat('A', 87), repeat('B', 22), 'Safari on iPhone'),
          ('${ids.vol}', 'https://push.example.test/vol', repeat('C', 87), repeat('D', 22), 'Chrome on Android');
        INSERT INTO public.push_outbox(user_id, subscription_id, notification_id, type)
        SELECT s.user_id, s.id, _n, 'meeting' FROM public.push_subscriptions s;
        -- Media library (20261216090000): an album with a cover, a photo sent for a KEPT imported event (it goes: only
        -- the imported event_media rows are kept), an upload request with a pending file, viewed markers, Storage
        -- objects with copies in media-library, and a hash on a kept event file (the kept row stays as it is).
        SELECT id INTO _ke FROM public.events WHERE past_record AND branch_id = '${ids.b1}' AND deleted_at IS NULL ORDER BY id LIMIT 1;
        INSERT INTO public.media_albums(branch_id, title, created_by) VALUES ('${ids.b1}', 'Volunteer meet-ups', '${ids.bm}') RETURNING id INTO _al;
        _ph := gen_random_uuid();
        INSERT INTO public.media_photos(id, branch_id, album_id, storage_path, content_hash, ready, uploaded_by)
        VALUES (_ph, '${ids.b1}', _al, '${ids.b1}/' || _ph || '.jpg', repeat('a', 64), true, '${ids.bm}');
        UPDATE public.media_albums SET cover_photo_id = _ph WHERE id = _al;
        INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', '${ids.b1}/' || _ph || '.jpg'),
          ('media-library', '${ids.b1}/' || _ph || '.w640.webp'), ('media-library', '${ids.b1}/' || _ph || '.w1280.webp');
        _ph := gen_random_uuid();
        INSERT INTO public.media_upload_requests(branch_id, requester_id, event_id, note, status, result_event_id, reviewer_id)
        VALUES ('${ids.b1}', '${ids.vol}', _ke, 'From the evening', 'approved', _ke, '${ids.bm}') RETURNING id INTO _mr;
        INSERT INTO public.media_photos(id, branch_id, event_id, storage_path, ready, uploaded_by, approved_by, request_id)
        VALUES (_ph, '${ids.b1}', _ke, '${ids.b1}/' || _ph || '.png', true, '${ids.vol}', '${ids.bm}', _mr);
        INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', '${ids.b1}/' || _ph || '.png');
        INSERT INTO public.media_upload_requests(branch_id, requester_id, proposed_title, status, submitted_at)
        VALUES ('${ids.b1}', '${ids.vol}', 'Peace Walk', 'submitted', now()) RETURNING id INTO _mr;
        _ph := gen_random_uuid();
        INSERT INTO public.media_upload_files(id, request_id, branch_id, storage_path, ready)
        VALUES (_ph, _mr, '${ids.b1}', '${ids.b1}/' || _ph || '.webp', true);
        INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', '${ids.b1}/' || _ph || '.webp');
        INSERT INTO public.media_chapter_views(user_id, album_id) VALUES ('${ids.vol}', _al);
        INSERT INTO public.media_chapter_views(user_id, event_id) VALUES ('${ids.vol}', _ke), ('${ids.nc}', _ke);
      END $$;`);
    // A task group ("@all") created through its RPC by the Branch Manager (tasks, assignees, notices).
    await as(ids.bm);
    await db.query("SELECT public.create_task_group($1::jsonb)", [
      JSON.stringify({ scope: "branch", branch_id: ids.b1, title: "Bring a friend" }),
    ]);
    await as(null);
    await db.exec("COMMIT");

    ncSettings = {
      user_followed_branches: await count("user_followed_branches", `user_id='${ids.nc}'`),
      consent_preferences: await count("consent_preferences", `user_id='${ids.nc}'`),
      notification_preferences: await count("notification_preferences", `user_id='${ids.nc}'`),
      privacy_notice_acceptances: await count("privacy_notice_acceptances", `user_id='${ids.nc}'`),
      push_subscriptions: await count("push_subscriptions", `user_id='${ids.nc}'`),
    };
    deleteObjects = (
      await q<{ o: string }>(
        `SELECT bucket_id || ':' || name o FROM storage.objects WHERE NOT (bucket_id = 'event-media' AND (split_part(name, '/', 1) = ANY ($1::text[])
           OR name IN (SELECT thumb_path FROM event_videos WHERE id = ANY ($2::uuid[]) AND thumb_path IS NOT NULL))) ORDER BY 1`,
        [keptEvents, keptVideos],
      )
    ).map((r) => r.o);
  }, 60000);

  it("is seeded like production: every table has data", async () => {
    expect(keptEvents).toHaveLength(15);
    expect(keptVideos).toHaveLength(6);
    expect(keptMedia).toHaveLength(16);
    const empty = await q<{ t: string }>(
      `SELECT c.relname t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'postcode_geocodes'`,
    );
    const withoutRows: string[] = [];
    for (const { t } of empty) if ((await count(`public.${t}`)) === 0) withoutRows.push(t);
    expect(withoutRows).toEqual([]);
    expect(deleteObjects.length).toBeGreaterThan(5);
  });

  it("the report shows the keep set, the delete counts and no uncovered table", async () => {
    const rows = await report();
    const find = (section: string, name: string) =>
      rows.find((r) => r.section === section && r.name === name);
    expect(find("KEEP account", "(count of KEEP accounts — must be 1)")?.n).toBe(1);
    expect(find("KEEP account", "first.last@dialoguesociety.test")?.detail).toMatch(/^KEEP/);
    expect(find("KEEP account", "nc@dialoguesociety.test")?.detail).toMatch(/^DELETE/);
    expect(find("KEEP imported event", "(count — expect 15)")?.n).toBe(15);
    expect(rows.filter((r) => r.section === "KEEP highlight video")).toHaveLength(6);
    expect(rows.filter((r) => r.section === "NOT COVERED")).toEqual([]);
    expect(find("DELETE rows", "task_groups")?.n).toBeGreaterThan(0);
    expect(find("DELETE rows", "auth.users")?.n).toBe(7);
    const storageDeletes = rows
      .filter((r) => r.section === "DELETE storage")
      .reduce((s, r) => s + (r.n ?? 0), 0);
    expect(storageDeletes).toBe(deleteObjects.length);
    // Every public table is either kept reference data or counted in "DELETE rows".
    const counted = new Set(rows.filter((r) => r.section === "DELETE rows").map((r) => r.name));
    const tables = await q<{ t: string }>(
      "SELECT relname t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'",
    );
    for (const { t } of tables)
      if (!["regions", "branches", "postcode_geocodes"].includes(t))
        expect(counted.has(t), t).toBe(true);
  });

  it("the storage list names exactly the objects outside the keep set, with a summary per bucket", async () => {
    const rows = await storageList();
    const summary = rows.filter((r) => r.name.startsWith("#"));
    const objects = rows
      .filter((r) => !r.name.startsWith("#"))
      .map((r) => `${r.bucket_id}:${r.name}`);
    expect(objects.sort()).toEqual([...deleteObjects].sort());
    expect(summary.find((r) => r.bucket_id === "(all buckets)")?.name).toBe(
      `# summary: delete ${deleteObjects.length} / keep 51 / total ${deleteObjects.length + 51}`,
    );
    for (const bucket of ["event-media", "meeting-files", "event-request-files"])
      expect(summary.some((r) => r.bucket_id === bucket)).toBe(true);
    expect(objects.some((o) => o.endsWith(".w640.webp"))).toBe(true); // copies of deleted events go too
  });

  it("deletes everything but the kept NC, events, media and videos; reassigns them; a second run changes nothing", () =>
    tx(async () => {
      const reportBefore = await report();
      const regions = await count("regions");
      const branches = await count("branches");
      // Storage first (in the dashboard; simulated here), rows second.
      for (const o of await storageList())
        if (!o.name.startsWith("#"))
          await db.query("DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2", [
            o.bucket_id,
            o.name,
          ]);

      const notices = await reset();
      expect(notices.join("\n")).toContain("prelaunch reset: verified");

      expect(await q("SELECT id, email FROM auth.users")).toEqual([
        { id: ids.nc, email: "first.last@dialoguesociety.test" },
      ]);
      expect(await q("SELECT id, status, deleted_at FROM profiles")).toEqual([
        { id: ids.nc, status: "active", deleted_at: null },
      ]);
      expect(await q("SELECT user_id, role FROM user_roles")).toEqual([
        { user_id: ids.nc, role: "national_coordinator" },
      ]);
      expect(await q("SELECT user_id FROM auth.mfa_factors")).toEqual([{ user_id: ids.nc }]);
      for (const t of [
        "auth.identities",
        "auth.sessions",
        "auth.one_time_tokens",
        "auth.flow_state",
      ])
        expect(await count(t, `user_id IS DISTINCT FROM '${ids.nc}'`), t).toBe(0);
      expect(await count("auth.refresh_tokens", `user_id IS DISTINCT FROM '${ids.nc}'`)).toBe(0);
      expect(await count("auth.refresh_tokens")).toBe(1);
      expect(await q("SELECT payload->>'actor_id' a FROM auth.audit_log_entries")).toEqual([
        { a: ids.nc },
      ]);

      expect(
        (await q<{ id: string }>("SELECT id FROM events ORDER BY id")).map((r) => r.id),
      ).toEqual(keptEvents);
      expect(await count("events", `created_by = '${ids.nc}'`)).toBe(15);
      expect(
        (await q<{ id: string }>("SELECT id FROM event_media ORDER BY id")).map((r) => r.id),
      ).toEqual(keptMedia);
      expect(await count("event_media", `uploaded_by = '${ids.nc}'`)).toBe(1); // the volunteer's photo
      expect(await count("event_media", "uploaded_by IS NULL")).toBe(15); // imported photos stay without uploader
      expect(
        (await q<{ id: string }>("SELECT id FROM event_videos ORDER BY id")).map((r) => r.id),
      ).toEqual(keptVideos);
      expect(await count("event_videos", `created_by = '${ids.nc}'`)).toBe(1);
      expect(await count("event_videos", "created_by IS NULL AND event_id IS NULL")).toBe(5);

      expect(await count("regions")).toBe(regions);
      expect(await count("branches")).toBe(branches);
      expect(await one("SELECT deleted_by v FROM branches WHERE id=$1", [ids.bGone])).toBe(ids.nc);
      for (const [t, n] of Object.entries(ncSettings)) {
        expect(await count(t), t).toBe(n);
        expect(n, t).toBeGreaterThan(0);
      }
      const tables = await q<{ t: string }>(
        "SELECT relname t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1",
      );
      for (const { t } of tables)
        if (!KEPT_TABLES.includes(t)) expect(await count(`public.${t}`), t).toBe(0);

      // The report's "kept" column was right, and after the reset nothing is left to delete.
      for (const r of reportBefore.filter((x) => x.section === "DELETE rows")) {
        const kept = Number(/kept (\d+)/.exec(r.detail)![1]);
        expect(await count(r.name.includes(".") ? r.name : `public.${r.name}`), r.name).toBe(kept);
      }
      const after = await report();
      for (const r of after.filter(
        (x) => x.section === "DELETE rows" || x.section === "DELETE storage",
      ))
        expect(r.n, r.name).toBe(0);
      expect(after.find((r) => r.name === "events.created_by IS NULL (kept events)")?.n).toBe(0);
      expect(after.find((r) => r.name === "(count of KEEP accounts — must be 1)")?.n).toBe(1);
      expect((await storageList()).filter((r) => !r.name.startsWith("#"))).toEqual([]);

      // Idempotent: the second run passes and changes nothing at all.
      const before = await snapshot();
      expect((await reset()).join("\n")).toContain("prelaunch reset: verified");
      expect(await snapshot()).toEqual(before);
    }));

  it("aborts with nothing changed when a second dotted NC exists", () =>
    tx(async () => {
      await db.exec(`INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('${id(30)}', 'other.nc@x.test',
          jsonb_build_object('privacy_notice_version','1.6'));
        UPDATE user_roles SET role='national_coordinator' WHERE user_id='${id(30)}';
        UPDATE profiles SET status='active' WHERE id='${id(30)}';`);
      const before = await snapshot();
      await resetFails("found 2, 15, 6");
      expect(await snapshot()).toEqual(before);
    }));

  it("aborts with nothing changed when only 14 imported events are found", () =>
    tx(async () => {
      // An imported event without an attached video (ids are random: the one with the video would also drop a video).
      const noVideo = keptEvents.find((e) => !keptVideoEvents.includes(e))!;
      await db.query("DELETE FROM event_media WHERE event_id=$1 AND source_url IS NOT NULL", [
        noVideo,
      ]);
      const before = await snapshot();
      await resetFails("found 1, 14, 6");
      expect(await snapshot()).toEqual(before);
    }));

  it("aborts when a highlight video is missing, the NC has no MFA factor or is not active", () =>
    tx(async () => {
      await db.exec("SAVEPOINT a");
      await db.query("DELETE FROM event_videos WHERE id=$1", [keptVideos[0]]);
      await resetFails("found 1, 15, 5");
      await db.exec("ROLLBACK TO SAVEPOINT a");
      await db.query("DELETE FROM auth.mfa_factors WHERE user_id=$1", [ids.nc]);
      await resetFails("has no MFA factor");
      await db.exec("ROLLBACK TO SAVEPOINT a");
      await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [ids.nc]);
      await resetFails("is not active");
      await db.exec("ROLLBACK TO SAVEPOINT a");
      expect(await count("auth.users")).toBe(8);
    }));

  it("aborts when a kept event belongs to a series or has a deletion job", () =>
    tx(async () => {
      await db.query("INSERT INTO event_deletion_jobs(event_id) VALUES ($1)", [keptEvents[1]]);
      await resetFails("has a deletion job");
    }));

  it("aborts when a new public table holds data the reset does not know", () =>
    tx(async () => {
      await db.exec(
        "CREATE TABLE public.zz_new_feature(id int); INSERT INTO public.zz_new_feature VALUES (1);",
      );
      expect(
        (await report()).filter((r) => r.section === "NOT COVERED").map((r) => r.name),
      ).toEqual(["zz_new_feature"]);
      await resetFails("public.zz_new_feature still has 1 rows");
    }));
});
