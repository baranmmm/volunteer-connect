import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { initializeRecycleDatabase } from './recycle-db-fixture';

const db = new PGlite();
const ids = { director: '10000000-0000-4000-8000-000000000001', manager: '10000000-0000-4000-8000-000000000002', volunteer: '10000000-0000-4000-8000-000000000003', other: '10000000-0000-4000-8000-000000000004', outside: '10000000-0000-4000-8000-000000000005', region: '10000000-0000-4000-8000-000000000006', region2: '10000000-0000-4000-8000-000000000007', branch: '10000000-0000-4000-8000-000000000008', branch2: '10000000-0000-4000-8000-000000000009', branch3: '10000000-0000-4000-8000-000000000010' };
let event = '', otherEvent = '', outsideEvent = '';
beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Bin region'),('${ids.region2}','Outside bin region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.branch}','Branch one','${ids.region}'),('${ids.branch2}','Branch two','${ids.region}'),('${ids.branch3}','Outside branch','${ids.region2}');
    INSERT INTO auth.users(id,email) VALUES ('${ids.director}','director@example.test'),('${ids.manager}','manager@example.test'),('${ids.volunteer}','member@example.test'),('${ids.other}','other@example.test'),('${ids.outside}','outside@example.test');
    UPDATE profiles SET status='active',branch_id='${ids.branch}',full_name='Bin member',phone='private phone';
    UPDATE profiles SET branch_id='${ids.branch2}' WHERE id='${ids.other}';
    UPDATE profiles SET branch_id='${ids.branch3}' WHERE id='${ids.outside}';
    UPDATE user_roles SET role='regional_director',region_id='${ids.region}' WHERE user_id='${ids.director}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.manager}';
    INSERT INTO events(title,organizer,category,scope,branch_id,region_id,status,deleted_at) VALUES ('Local event','DS','community','branch','${ids.branch}','${ids.region}','draft',now()),('Other event','DS','community','branch','${ids.branch2}','${ids.region}','draft',now()),('Outside event','DS','community','branch','${ids.branch3}','${ids.region2}','draft',now());`);
  const rows = await db.query<{ id: string; title: string }>('SELECT id,title FROM events');
  event = rows.rows.find(r => r.title === 'Local event')?.id ?? '';
  otherEvent = rows.rows.find(r => r.title === 'Other event')?.id ?? '';
  outsideEvent = rows.rows.find(r => r.title === 'Outside event')?.id ?? '';
  if (!event || !otherEvent || !outsideEvent) throw new Error('Missing fixture events');
}, 20000);
afterAll(async () => db.close());
async function as(user: string) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]); await db.exec('SET LOCAL ROLE authenticated'); }
async function rollback(action: () => Promise<void>) { await db.exec('BEGIN'); try { await action(); } finally { await db.exec('ROLLBACK'); } }
async function softUser(user = ids.volunteer, self = false) {
  await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [user]);
  if (self) await db.query('INSERT INTO account_deletion_requests(user_id) VALUES($1)', [user]);
  const result = await db.query<{ audit: string }>('SELECT authorize_user_deletion($1,$2) AS audit', [ids.director, user]);
  const audit = result.rows[0]?.audit;
  if (!audit) throw new Error('No audit');
  await db.query('SELECT record_user_deletion($1,$2,$3)', [ids.director, user, audit]);
}
describe('shared Recycle Bin database enforcement', () => {
  it('Branch Managers list and restore only their own branch events', async () => rollback(async () => {
    await as(ids.manager);
    expect((await db.query('SELECT id FROM list_recycle_bin()')).rows).toEqual([{ id: event }]);
    await db.query('SELECT restore_item($1,$2)', ['event', event]);
    await db.query('SELECT restore_event($1,true)', [event]);
    expect((await db.query('SELECT id FROM events WHERE id=$1', [event])).rows).toEqual([{ id: event }]);
    await expect(db.query('SELECT restore_item($1,$2)', ['event', otherEvent])).rejects.toThrow('Event cannot be restored');
  }));
  it('Regional Directors list their region and no outside items', async () => rollback(async () => {
    await as(ids.director);
    expect((await db.query<{ id: string }>('SELECT id FROM list_recycle_bin()')).rows.map(r => r.id).sort()).toEqual([event, otherEvent].sort());
  }));
  it('Volunteers cannot list, restore or permanently delete by direct API', async () => rollback(async () => {
    await as(ids.volunteer);
    await expect(db.query('SELECT * FROM list_recycle_bin()')).rejects.toThrow('Not allowed');
    await db.exec('ROLLBACK; BEGIN'); await as(ids.volunteer);
    await expect(db.query('SELECT restore_item($1,$2)', ['event', event])).rejects.toThrow('Event cannot be restored');
    await db.exec('ROLLBACK; BEGIN'); await as(ids.volunteer);
    await expect(db.query('SELECT permanent_delete_item($1,$2,$3)', ['event', event, 'DELETE'])).rejects.toThrow('Not allowed');
  }));
  it('deleted users disappear from profile reads including their own token; bin omits private fields', async () => rollback(async () => {
    await softUser(); await as(ids.manager);
    expect((await db.query('SELECT id FROM profiles WHERE id=$1', [ids.volunteer])).rows).toEqual([]);
    const rows = await db.query<{ title: string; can_restore: boolean; days_left: number }>("SELECT * FROM list_recycle_bin('user')");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ title: 'Bin member', can_restore: true, days_left: 30 });
    expect(Object.keys(rows.rows[0] ?? {})).not.toContain('email');
    expect(Object.keys(rows.rows[0] ?? {})).not.toContain('phone');
    await as(ids.volunteer);
    expect((await db.query('SELECT id FROM profiles WHERE id=$1', [ids.volunteer])).rows).toEqual([]);
    expect((await db.query('SELECT can_manage_user($1,$2) AS allowed', [ids.volunteer, ids.manager])).rows).toEqual([{ allowed: false }]);
  }));
  it('an admin-deleted user can be restored within 30 days with role/status retained and audit recorded', async () => rollback(async () => {
    await softUser(); await as(ids.manager);
    await db.query('SELECT restore_item($1,$2)', ['user', ids.volunteer]);
    await db.exec('RESET ROLE');
    await db.query('SELECT finish_user_recycle_operation($1,$2)', [ids.volunteer, 'restore']);
    expect((await db.query('SELECT deleted_at,status FROM profiles WHERE id=$1', [ids.volunteer])).rows).toEqual([{ deleted_at: null, status: 'inactive' }]);
    expect((await db.query('SELECT role FROM user_roles WHERE user_id=$1', [ids.volunteer])).rows).toEqual([{ role: 'volunteer' }]);
    expect((await db.query("SELECT actor_id FROM recycle_bin_audit_log WHERE item_id=$1 AND action='restore'", [ids.volunteer])).rows).toEqual([{ actor_id: ids.manager }]);
  }));
  it('self-requested erasure uses the existing request and cannot be restored', async () => rollback(async () => {
    await softUser(ids.volunteer, true); await as(ids.manager);
    expect((await db.query("SELECT self_requested,can_restore FROM list_recycle_bin('user')")).rows).toEqual([{ self_requested: true, can_restore: false }]);
    await expect(db.query('SELECT restore_item($1,$2)', ['user', ids.volunteer])).rejects.toThrow('Item cannot be restored');
  }));
  it('Branch Managers cannot list or restore another branch user', async () => rollback(async () => {
    await softUser(ids.other); await as(ids.manager);
    expect((await db.query("SELECT id FROM list_recycle_bin('user')")).rows).toEqual([]);
    await expect(db.query('SELECT restore_item($1,$2)', ['user', ids.other])).rejects.toThrow('Item cannot be restored');
  }));
  it('restoration expires at exactly 30 days', async () => rollback(async () => {
    await softUser();
    await db.query("UPDATE profiles SET deleted_at=now()-interval '30 days' WHERE id=$1", [ids.volunteer]);
    await as(ids.manager);
    expect((await db.query("SELECT days_left,can_restore FROM list_recycle_bin('user')")).rows).toEqual([{ days_left: 0, can_restore: false }]);
    await expect(db.query('SELECT restore_item($1,$2)', ['user', ids.volunteer])).rejects.toThrow('Item cannot be restored');
  }));
  it('permanent deletion requires exact DELETE and is permission scoped', async () => rollback(async () => {
    await as(ids.manager);
    await expect(db.query('SELECT permanent_delete_item($1,$2,$3)', ['event', event, 'delete'])).rejects.toThrow('Permanent deletion confirmation required');
  }));
  it('manual event purge is allowed before 30 days, retains audit and is idempotent', async () => rollback(async () => {
    await as(ids.manager);
    await db.query('SELECT permanent_delete_item($1,$2,$3)', ['event', event, 'DELETE']);
    await db.exec('RESET ROLE');
    await db.query('SELECT purge_event($1,true)', [event]);
    expect((await db.query('SELECT id FROM events WHERE id=$1', [event])).rows).toEqual([]);
    expect((await db.query("SELECT actor_id FROM recycle_bin_audit_log WHERE item_id=$1 AND action='permanent_delete'", [event])).rows).toEqual([{ actor_id: ids.manager }]);
    expect((await db.query<{ result: { deleted: boolean } }>('SELECT purge_event($1,true) AS result', [event])).rows[0]?.result.deleted).toBe(true);
  }));
  it('scheduled user purge only accepts strictly older than 30 days and requires Auth erasure first', async () => rollback(async () => {
    await softUser();
    await db.query("UPDATE profiles SET deleted_at=now()-interval '30 days' WHERE id=$1", [ids.volunteer]);
    await expect(db.query('SELECT prepare_user_purge($1)', [ids.volunteer])).rejects.toThrow('Item cannot be purged');
  }));
  it('scheduled user erasure cascades personal data, keeps audit and is harmless on retry', async () => rollback(async () => {
    await softUser();
    await db.query("UPDATE profiles SET deleted_at=now()-interval '31 days' WHERE id=$1", [ids.volunteer]);
    await db.query('SELECT prepare_user_purge($1)', [ids.volunteer]);
    // Isolated Auth fixture only: production erasure is always through the Auth API.
    await db.query('DELETE FROM auth.users WHERE id=$1', [ids.volunteer]);
    await db.query('SELECT finish_user_recycle_operation($1,$2)', [ids.volunteer, 'purge']);
    expect((await db.query('SELECT id FROM profiles WHERE id=$1', [ids.volunteer])).rows).toEqual([]);
    expect((await db.query('SELECT id FROM user_roles WHERE user_id=$1', [ids.volunteer])).rows).toEqual([]);
    expect((await db.query("SELECT actor_id FROM recycle_bin_audit_log WHERE item_id=$1 AND action='permanent_delete'", [ids.volunteer])).rows).toEqual([{ actor_id: null }]);
    expect((await db.query<{ result: { deleted: boolean } }>('SELECT prepare_user_purge($1) AS result', [ids.volunteer])).rows[0]?.result.deleted).toBe(true);
  }));
  it('server-only account erasure helpers are not client callable; client operations reject anon', async () => {
    for (const name of ['prepare_user_purge(uuid,uuid)', 'finish_user_recycle_operation(uuid,text)', 'authorize_user_deletion(uuid,uuid,uuid)']) {
      expect((await db.query(`SELECT has_function_privilege('authenticated','${name}','EXECUTE') AS member,has_function_privilege('service_role','${name}','EXECUTE') AS service`)).rows).toEqual([{ member: false, service: true }]);
    }
    for (const name of ['list_recycle_bin(text,text,integer)', 'restore_item(text,uuid)', 'permanent_delete_item(text,uuid,text)']) expect((await db.query(`SELECT has_function_privilege('anon','${name}','EXECUTE') AS allowed`)).rows).toEqual([{ allowed: false }]);
  });
  it('search and type filtering happen before pagination', async () => rollback(async () => {
    await softUser(); await as(ids.director);
    expect((await db.query("SELECT title,total_count FROM list_recycle_bin('event','other',0)")).rows).toEqual([{ title: 'Other event', total_count: 1 }]);
    expect((await db.query("SELECT type FROM list_recycle_bin('user','member',0)")).rows).toEqual([{ type: 'user' }]);
  }));
});