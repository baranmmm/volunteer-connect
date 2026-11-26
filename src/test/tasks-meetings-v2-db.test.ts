import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Tasks + Meetings v2 against every migration in PGlite: one calendar (meeting ↔ event), recurring meetings, agenda
// follow-up, task archive and notes, volunteer assignment, reminders off by default. Each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  b2: id(3),
  rd: id(10),
  bm1: id(11),
  vol1: id(12),
  vol1b: id(13),
  vol2: id(14),
  nc: id(16),
};
type Row = Record<string, unknown>;

async function as(user: string | null, aal = "aal1") {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal',$2,true)",
    [user ?? "", aal],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function q<T = Row>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function one<T = unknown>(sql: string, params: unknown[] = []) {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  return row?.v as T;
}
async function fails(sql: string, params: unknown[], message: string) {
  await db.exec("SAVEPOINT sp");
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec("ROLLBACK TO SAVEPOINT sp");
  }
}
async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}
const inDays = (days: number, hour = 18) => {
  const d = new Date(Date.now() + days * 86400000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const meeting = (extra: Row = {}) => ({
  scope: "branch",
  branch_id: ids.b1,
  title: "Committee",
  starts_at: inDays(5),
  ends_at: inDays(5, 19),
  location_type: "in_person",
  location: "Hall",
  ...extra,
});
const createMeeting = (p: Row) =>
  one<string>("SELECT public.create_meeting($1::jsonb) v", [JSON.stringify(p)]);
const createTask = (p: Row) =>
  one<string>("SELECT public.create_task($1::jsonb) v", [JSON.stringify(p)]);
const eventOf = async (meetingId: string) => {
  await as(null);
  return (
    await q<Row>("SELECT e.* FROM events e JOIN meetings m ON m.event_id = e.id WHERE m.id = $1", [
      meetingId,
    ])
  )[0]!;
};
const notices = async (user: string, kind: string) => {
  await as(null);
  return q<{ entity_id: string }>(
    "SELECT entity_id FROM notifications WHERE user_id=$1 AND kind=$2 ORDER BY created_at",
    [user, kind],
  );
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const members = [ids.rd, ids.bm1, ids.vol1, ids.vol1b, ids.vol2, ids.nc];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.6')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id='${ids.vol2}';
    UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.rd}','${ids.nc}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
}, 60000);
afterAll(async () => db.close());

describe("one calendar: a meeting and its event are one linked record", () => {
  it("creating a meeting creates a members-only calendar entry without registration, visible only to the meeting's people", () =>
    tx(async () => {
      await as(ids.vol1);
      const m = await createMeeting(meeting({ invitee_ids: [ids.vol1b] }));
      const e = await eventOf(m);
      expect(e).toMatchObject({
        category: "meeting",
        audience: "members",
        registration_enabled: false,
        capacity: null,
        status: "published",
        title: "Committee",
        location: "Hall",
      });
      expect(
        await one("SELECT public.is_public_event(e) v FROM events e WHERE id=$1", [e["id"]]),
      ).toBe(false);
      expect(
        await one("SELECT public.event_is_upcoming(e) v FROM events e WHERE id=$1", [e["id"]]),
      ).toBe(false);
      for (const [user, visible] of [
        [ids.vol1, true],
        [ids.vol1b, true],
        [ids.bm1, true],
        [ids.rd, true],
        [ids.vol2, false],
      ] as const) {
        await as(user);
        expect(
          await one("SELECT count(*)::int v FROM events WHERE id=$1", [e["id"]]),
          `${user} sees the calendar entry`,
        ).toBe(visible ? 1 : 0);
      }
      // A branch member who is not invited sees neither.
      await db.exec(`RESET ROLE; INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${id(30)}', jsonb_build_object('full_name','Other','privacy_notice_version','1.6'));
        UPDATE profiles SET status='active', branch_id='${ids.b1}' WHERE id='${id(30)}';`);
      await as(id(30));
      expect(await one("SELECT count(*)::int v FROM events WHERE id=$1", [e["id"]])).toBe(0);
      // No registration for meetings, even for invitees.
      await as(ids.vol1b);
      await fails("SELECT public.register_for_event($1)", [e["id"]], "Registration is closed");
    }));

  it("edits on either side update both: meeting form → event, event form → meeting (invitees told), cancel both ways", () =>
    tx(async () => {
      await as(ids.vol1);
      const m = await createMeeting(meeting({ invitee_ids: [ids.vol1b] }));
      await db.query("SELECT public.update_meeting($1, $2::jsonb)", [
        m,
        JSON.stringify({ title: "Committee (moved)", location: "Library" }),
      ]);
      expect(await eventOf(m)).toMatchObject({ title: "Committee (moved)", location: "Library" });

      // The Branch Manager edits the calendar entry: the meeting follows and the invitee is told.
      const e = await eventOf(m);
      await as(ids.bm1);
      const full = {
        title: "Committee (event side)",
        scope: "branch",
        branch_id: ids.b1,
        status: "published",
        category: "meeting",
        start_at: inDays(6),
        end_at: inDays(6, 20),
        location_type: "in_person",
        location: "Library",
      };
      await db.query("SELECT public.update_event($1, $2::jsonb)", [e["id"], JSON.stringify(full)]);
      await as(null);
      const row = (await q<Row>("SELECT title, starts_at FROM meetings WHERE id=$1", [m]))[0]!;
      expect(row["title"]).toBe("Committee (event side)");
      expect(new Date(row["starts_at"] as string).toISOString()).toBe(inDays(6));
      expect((await notices(ids.vol1b, "meeting_changed")).length).toBeGreaterThan(0);

      // Cancel on the event side → meeting cancelled; reopen the meeting → event published again.
      await as(ids.bm1);
      await db.query("SELECT public.cancel_event($1)", [e["id"]]);
      await as(null);
      expect(await one("SELECT status v FROM meetings WHERE id=$1", [m])).toBe("cancelled");
      await as(ids.vol1);
      await db.query("SELECT public.set_meeting_status($1, 'scheduled')", [m]);
      expect((await eventOf(m))["status"]).toBe("published");
    }));

  it("deleting goes through the meeting; the calendar entry hides with it and returns on restore; purge removes both", () =>
    tx(async () => {
      await as(ids.bm1);
      const m = await createMeeting(meeting());
      const e = await eventOf(m);
      await as(ids.bm1);
      await fails("SELECT public.delete_event($1)", [e["id"]], "Delete the meeting instead");
      await db.query("SELECT public.delete_meeting($1)", [m]);
      expect(await one("SELECT count(*)::int v FROM events WHERE id=$1", [e["id"]])).toBe(0);
      await db.query("SELECT public.restore_item('meeting', $1)", [m]);
      expect(await one("SELECT count(*)::int v FROM events WHERE id=$1", [e["id"]])).toBe(1);
      await db.query("SELECT public.delete_meeting($1)", [m]);
      await as(null);
      await db.exec(
        `UPDATE meetings SET deleted_at = now() - interval '40 days' WHERE id = '${m}'`,
      );
      await db.query("SELECT public.purge_meeting($1, true)", [m]);
      expect(await one("SELECT count(*)::int v FROM events WHERE id=$1", [e["id"]])).toBe(0);
    }));

  it("an event created with the category Meeting creates its meeting; the category cannot change later", () =>
    tx(async () => {
      await as(ids.bm1);
      const event = await one<string>("SELECT public.create_event($1::jsonb) v", [
        JSON.stringify({
          title: "Planning",
          scope: "branch",
          branch_id: ids.b1,
          category: "meeting",
          status: "draft",
          start_at: inDays(4),
          end_at: inDays(4, 19),
          location_type: "online",
          online_url: "https://meet.example.org/x",
        }),
      ]);
      await as(null);
      const m = (await q<Row>("SELECT * FROM meetings WHERE event_id=$1", [event]))[0]!;
      expect(m).toMatchObject({ title: "Planning", location_type: "online", created_by: ids.bm1 });
      expect(await one("SELECT status v FROM events WHERE id=$1", [event])).toBe("published");
      await as(ids.bm1);
      await fails(
        "SELECT public.update_event($1, $2::jsonb)",
        [
          event,
          JSON.stringify({
            title: "Planning",
            scope: "branch",
            branch_id: ids.b1,
            status: "published",
            category: "dinner",
            start_at: inDays(4),
            end_at: inDays(4, 19),
            location: "Hall",
          }),
        ],
        "The category of a meeting cannot change",
      );
    }));
});

describe("recurring meetings", () => {
  it("weekly × 4 keeps 18:00 London across the clock change; invitees and standing agenda items are copied; invitees told once", () =>
    tx(async () => {
      await as(ids.bm1);
      // 23 March 2027 18:00 GMT; the clocks go forward on 28 March.
      const m = await createMeeting(
        meeting({
          starts_at: "2027-03-23T18:00:00Z",
          ends_at: "2027-03-23T19:00:00Z",
          invitee_ids: [ids.vol1],
          agenda: ["Updates", "Any other business"],
          recurrence: { freq: "weekly", interval: 1, count: 4 },
        }),
      );
      await as(null);
      const series = await q<{ id: string; starts_at: string; series_position: number }>(
        "SELECT id, starts_at, series_position FROM meetings WHERE series_id = (SELECT series_id FROM meetings WHERE id=$1) ORDER BY starts_at",
        [m],
      );
      expect(series.map((s) => new Date(s.starts_at).toISOString())).toEqual([
        "2027-03-23T18:00:00.000Z",
        "2027-03-30T17:00:00.000Z",
        "2027-04-06T17:00:00.000Z",
        "2027-04-13T17:00:00.000Z",
      ]);
      expect(series.map((s) => s.series_position)).toEqual([1, 2, 3, 4]);
      for (const s of series) {
        expect(
          await one("SELECT count(*)::int v FROM meeting_invitees WHERE meeting_id=$1", [s.id]),
        ).toBe(1);
        expect(
          await one(
            "SELECT count(*)::int v FROM meeting_agenda_items WHERE meeting_id=$1 AND standing",
            [s.id],
          ),
        ).toBe(2);
        expect(
          await one(
            "SELECT count(*)::int v FROM events e JOIN meetings x ON x.event_id=e.id WHERE x.id=$1",
            [s.id],
          ),
        ).toBe(1);
      }
      expect((await notices(ids.vol1, "meeting_invited")).length).toBe(1);
    }));

  it("this and following moves the later occurrences by the same amount; all deletes the whole series", () =>
    tx(async () => {
      await as(ids.bm1);
      const first = await createMeeting(
        meeting({
          starts_at: inDays(7),
          ends_at: inDays(7, 19),
          recurrence: { freq: "weekly", interval: 1, count: 3 },
        }),
      );
      await as(null);
      const all = await q<{ id: string }>(
        "SELECT id FROM meetings WHERE series_id = (SELECT series_id FROM meetings WHERE id=$1) ORDER BY starts_at",
        [first],
      );
      await as(ids.bm1);
      expect(
        await one("SELECT public.update_meeting_series($1, 'following', $2::jsonb) v", [
          all[1]!.id,
          JSON.stringify({ title: "Moved", starts_at: inDays(14, 19), ends_at: inDays(14, 20) }),
        ]),
      ).toBe(2);
      await as(null);
      const after = await q<{ title: string; starts_at: string }>(
        "SELECT title, starts_at FROM meetings WHERE id = ANY($1::uuid[]) ORDER BY starts_at",
        [all.map((x) => x.id)],
      );
      expect(after.map((x) => x.title)).toEqual(["Committee", "Moved", "Moved"]);
      expect(new Date(after[2]!.starts_at).toISOString()).toBe(inDays(21, 19));
      await as(ids.bm1);
      expect(await one("SELECT public.delete_meeting_series($1, 'all') v", [first])).toBe(3);
    }));

  it("'From last meeting' lists the previous occurrence's unresolved items and open tasks; series tasks span the series", () =>
    tx(async () => {
      await as(ids.bm1);
      const first = await createMeeting(
        meeting({
          starts_at: inDays(-7),
          ends_at: inDays(-7, 19),
          agenda: ["Budget", "Venue"],
          recurrence: { freq: "weekly", interval: 1, count: 2 },
        }),
      );
      await as(null);
      const second = await one<string>(
        "SELECT id v FROM meetings WHERE series_id = (SELECT series_id FROM meetings WHERE id=$1) AND id <> $1",
        [first],
      );
      const items = await q<{ id: string; title: string }>(
        "SELECT id, title FROM meeting_agenda_items WHERE meeting_id=$1 ORDER BY position",
        [first],
      );
      await as(ids.bm1);
      await db.query("SELECT public.set_agenda_item_resolved($1, true)", [items[1]!.id]);
      const decision = await one<string>(
        "SELECT public.add_meeting_decision($1, 'Book the hall') v",
        [items[0]!.id],
      );
      const task = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Book the hall",
        decision_id: decision,
        assignee_ids: [ids.vol1],
      });
      const got = await one<{
        from_last: { items: { title: string }[]; tasks: { id: string; status: string }[] };
      }>("SELECT public.get_meeting($1) v", [second]);
      expect(got.from_last.items.map((i) => i.title)).toEqual(["Budget"]);
      expect(got.from_last.tasks).toEqual([expect.objectContaining({ id: task, status: "todo" })]);
      expect(
        (await one<{ id: string }[]>("SELECT public.get_meeting_series_tasks($1) v", [second])).map(
          (t) => t.id,
        ),
      ).toEqual([task]);
    }));
});

describe("tasks v2", () => {
  it("a volunteer assigns themselves and volunteers of their branch, never upward or another branch", () =>
    tx(async () => {
      await as(ids.vol1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Flyers",
        assignee_ids: [ids.vol1, ids.vol1b],
      });
      await as(null);
      expect(
        (
          await q<{ user_id: string }>(
            "SELECT user_id FROM task_assignees WHERE task_id=$1 ORDER BY user_id",
            [t],
          )
        )
          .map((r) => r.user_id)
          .sort(),
      ).toEqual([ids.vol1, ids.vol1b].sort());
      await as(ids.vol1);
      for (const other of [ids.bm1, ids.vol2, ids.rd]) {
        await fails(
          "SELECT public.create_task($1::jsonb)",
          [
            JSON.stringify({
              scope: "branch",
              branch_id: ids.b1,
              title: "Up",
              assignee_ids: [other],
            }),
          ],
          "This person cannot be assigned",
        );
      }
      // Nobody chosen: the volunteer themselves.
      const own = await createTask({ scope: "branch", branch_id: ids.b1, title: "Mine" });
      await as(null);
      expect(await one("SELECT user_id v FROM task_assignees WHERE task_id=$1", [own])).toBe(
        ids.vol1,
      );
    }));

  it("reminders are off for a new task unless the form turns them on", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Quiet",
        due_date: "2030-01-10",
        assignee_ids: [ids.vol1],
      });
      await as(null);
      expect(await one("SELECT remind_before_days v FROM tasks WHERE id=$1", [t])).toEqual([]);
    }));

  it("archive: only done tasks; reopening unarchives; 'archive all done' skips what the caller may not change", () =>
    tx(async () => {
      await as(ids.bm1);
      const a = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "A",
        assignee_ids: [ids.vol1],
      });
      const b = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "B",
        assignee_ids: [ids.vol1b],
      });
      await as(ids.vol1);
      await fails("SELECT public.archive_task($1, true)", [a], "Only done tasks can be archived");
      await db.query("SELECT public.set_task_status($1, 'done')", [a]);
      await as(ids.bm1);
      await db.query("SELECT public.set_task_status($1, 'done')", [b]);
      await as(ids.vol1);
      expect(
        await one("SELECT public.archive_done_tasks($1::jsonb) v", [JSON.stringify([a, b])]),
      ).toBe(1);
      await as(null);
      expect(await one("SELECT archived_at IS NOT NULL v FROM tasks WHERE id=$1", [a])).toBe(true);
      expect(await one("SELECT archived_at IS NULL v FROM tasks WHERE id=$1", [b])).toBe(true);
      await as(ids.vol1);
      await db.query("SELECT public.set_task_status($1, 'in_progress')", [a]);
      await as(null);
      expect(await one("SELECT archived_at IS NULL v FROM tasks WHERE id=$1", [a])).toBe(true);
    }));

  it("notes: assignees write, the creator hears about it; mentions only for people who can see the task; authors edit their own", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Venue",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      const note = await one<string>(
        "SELECT public.add_task_note($1, 'Called the hall', $2::jsonb) v",
        [t, JSON.stringify([ids.vol1b])],
      );
      expect((await notices(ids.bm1, "task_note_added")).map((n) => n.entity_id)).toEqual([t]);
      expect((await notices(ids.vol1b, "task_note_mention")).map((n) => n.entity_id)).toEqual([t]);
      await as(ids.vol1);
      await fails(
        "SELECT public.add_task_note($1, 'Hi', $2::jsonb)",
        [t, JSON.stringify([ids.vol2])],
        "This person cannot see the task",
      );
      // A branch member who is not an assignee, creator or manager cannot write.
      await as(ids.vol1b);
      await fails("SELECT public.add_task_note($1, 'Me too', '[]'::jsonb)", [t], "Not allowed");
      await fails(
        "SELECT public.update_task_note($1, 'Changed', '[]'::jsonb)",
        [note],
        "Not allowed",
      );
      expect(await one<unknown[]>("SELECT public.list_task_notes($1) v", [t])).toHaveLength(1);
      await as(ids.vol1);
      await db.query("SELECT public.update_task_note($1, 'Called the hall twice', '[]'::jsonb)", [
        note,
      ]);
      await db.query("SELECT public.delete_task_note($1)", [note]);
      expect(await one<unknown[]>("SELECT public.list_task_notes($1) v", [t])).toHaveLength(0);
      await as(ids.vol2);
      expect(await one<unknown[]>("SELECT public.list_task_mention_people($1) v", [t])).toEqual([]);
    }));

  it("an event's linked tasks are listed for everyone who can see the event", () =>
    tx(async () => {
      await as(ids.bm1);
      const event = await one<string>("SELECT public.create_event($1::jsonb) v", [
        JSON.stringify({
          title: "Open day",
          scope: "branch",
          branch_id: ids.b1,
          category: "community",
          status: "published",
          start_at: inDays(9),
          end_at: inDays(9, 20),
          location: "Hall",
          organizer: "Branch",
        }),
      ]);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Posters",
        event_id: event,
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1b);
      expect(
        (await one<{ id: string }[]>("SELECT public.get_event_tasks($1) v", [event])).map(
          (x) => x.id,
        ),
      ).toEqual([t]);
    }));
});
