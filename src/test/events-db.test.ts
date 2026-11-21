import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
const db = new PGlite();
const ids = { director:'11111111-1111-4111-8111-111111111111',manager:'22222222-2222-4222-8222-222222222222',volunteer:'33333333-3333-4333-8333-333333333333',other:'44444444-4444-4444-8444-444444444444',outside:'55555555-5555-4555-8555-555555555555',branch:'66666666-6666-4666-8666-666666666666',branch2:'77777777-7777-4777-8777-777777777777',outsideBranch:'88888888-8888-4888-8888-888888888888',region:'99999999-9999-4999-8999-999999999999',outsideRegion:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
let branchEvent='',draftEvent='',regionEvent='',otherEvent='';
const data = (scope='branch', branch: string|null=ids.branch, status='published') => ({title:'Community gathering',description:'Meet neighbours',location:'London',organizer:'Dialogue Society',category:'community',start_at:'2027-01-01T18:00:00Z',end_at:null,capacity:null,scope,branch_id:branch,status});
async function create(value: object) { const result=await db.query<{id:string}>('SELECT public.create_event($1::jsonb) AS id',[JSON.stringify(value)]);const id=result.rows[0]?.id;if(!id)throw new Error('Missing event');return id; }
beforeAll(async () => {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE public.regions(id uuid PRIMARY KEY);
 CREATE TABLE public.branches(id uuid PRIMARY KEY,region_id uuid REFERENCES regions);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,status text,branch_id uuid REFERENCES branches);
 CREATE TABLE public.user_roles(user_id uuid,role text,region_id uuid);
 CREATE FUNCTION public.has_role(_user_id uuid,_role text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role)$$;
 CREATE FUNCTION public.get_user_branch(_user_id uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT branch_id FROM profiles WHERE id=_user_id$$;
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA public,storage,auth TO authenticated,anon; GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
 CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql AS $$SELECT reverse(split_part(reverse(name),'.',1))$$;
 INSERT INTO regions VALUES ('${ids.region}'),('${ids.outsideRegion}');
 INSERT INTO branches VALUES ('${ids.branch}','${ids.region}'),('${ids.branch2}','${ids.region}'),('${ids.outsideBranch}','${ids.outsideRegion}');
 INSERT INTO profiles VALUES ('${ids.director}','active','${ids.branch}'),('${ids.manager}','active','${ids.branch}'),('${ids.volunteer}','active','${ids.branch}'),('${ids.other}','active','${ids.branch2}'),('${ids.outside}','active','${ids.outsideBranch}');
 INSERT INTO user_roles VALUES ('${ids.director}','regional_director','${ids.region}'),('${ids.manager}','branch_manager',NULL),('${ids.volunteer}','volunteer',NULL),('${ids.other}','volunteer',NULL),('${ids.outside}','volunteer',NULL);
 SELECT set_config('request.jwt.claim.sub','${ids.director}',false);`);
 await db.exec(readFileSync('supabase/migrations/20261121021009_14fd0d35-04f4-4227-9f68-f27d1484bb2a.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261121210524_b4c6125f-0059-48b5-bfc6-174f70f8ad20.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261121213855_57294ac4-1b13-451c-8a93-8ec41a1f7873.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261121214016_b971cff3-80e7-4b68-82b8-56a94179dd2d.sql','utf8'));
 await db.exec('CREATE TABLE public.event_registrations(id uuid DEFAULT gen_random_uuid(),event_id uuid REFERENCES public.events(id),status text)');
 branchEvent=await create(data());draftEvent=await create(data('branch',ids.branch,'draft'));regionEvent=await create(data('region',null));otherEvent=await create(data('branch',ids.branch2));
},20000);
afterAll(async()=>db.close());
async function transaction(user: string, action: () => Promise<void>, before?:()=>Promise<void>) {
 await db.exec('BEGIN');
 try { if(before)await before();await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);await db.exec('SET LOCAL ROLE authenticated');await action(); } finally { await db.exec('ROLLBACK'); }
}
async function visible() { return (await db.query<{id:string}>('SELECT id FROM events ORDER BY id')).rows.map(r=>r.id).sort(); }
async function add(kind='image',extension='jpg',event=branchEvent) { const result=await db.query<{id:string}>('SELECT add_event_media($1,$2,$3) AS id',[event,kind,extension]);const id=result.rows[0]?.id;if(!id)throw new Error('Missing media');return id; }
describe('events database rules',()=>{
 it('a draft deletion removes media and event rows and retains who/which/when audit',async()=>transaction(ids.manager,async()=>{
   const media=await add('image','jpg',draftEvent);
   const prepared=await db.query<{result:{paths:string[]}}>('SELECT delete_event($1) AS result',[draftEvent]);
   expect(prepared.rows[0]?.result.paths).toEqual([`${draftEvent}/${media}.jpg`]);
   await db.query('SELECT delete_event($1,true)',[draftEvent]);
   expect((await db.query('SELECT id FROM events WHERE id=$1',[draftEvent])).rows).toEqual([]);
   expect((await db.query('SELECT id FROM event_media WHERE event_id=$1',[draftEvent])).rows).toEqual([]);
   await db.exec('RESET ROLE');
   const audit=await db.query<{actor_id:string;event_id:string;action:string;created_at:Date}>('SELECT actor_id,event_id,action,created_at FROM event_audit_log WHERE event_id=$1',[draftEvent]);
   expect(audit.rows[0]).toMatchObject({actor_id:ids.manager,event_id:draftEvent,action:'event_deleted'});
   expect(new Date(audit.rows[0]?.created_at ?? '').getTime()).toBeGreaterThan(0);
 }));
 it('does not finalize while stored files remain, including unmatched files',async()=>transaction(ids.manager,async()=>{
   const prepared=await db.query<{result:{paths:string[]}}>('SELECT delete_event($1) AS result',[draftEvent]);
   expect(prepared.rows[0]?.result.paths).toEqual([`${draftEvent}/orphan.png`]);
   await expect(db.query('SELECT delete_event($1,true)',[draftEvent])).rejects.toThrow('Event files still exist');
 },async()=>{await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('event-media',$1)",[`${draftEvent}/orphan.png`]);}));
 it('finalizes after storage cleanup and removes its durable job',async()=>transaction(ids.manager,async()=>{
   await add('pdf','pdf',draftEvent);
   await db.query('SELECT delete_event($1)',[draftEvent]);
   await db.exec('RESET ROLE');
   // Simulates the successful Storage API operation in the isolated database only.
   await db.query("DELETE FROM storage.objects WHERE bucket_id='event-media' AND name=$1",[`${draftEvent}/orphan.png`]);
   await db.exec('SET LOCAL ROLE authenticated');
   await db.query('SELECT delete_event($1,true)',[draftEvent]);
   expect((await db.query('SELECT event_id FROM event_deletion_jobs WHERE event_id=$1',[draftEvent])).rows).toEqual([]);
 },async()=>{await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('event-media',$1)",[`${draftEvent}/orphan.png`]);}));
 it('past published events cannot be deleted',async()=>transaction(ids.manager,async()=>{
   await expect(db.query('SELECT delete_event($1)',[branchEvent])).rejects.toThrow('Event cannot be deleted');
 },async()=>{await db.query("UPDATE events SET start_at='2020-01-01T00:00:00Z' WHERE id=$1",[branchEvent]);}));
 it('published events starting now cannot be deleted',async()=>transaction(ids.manager,async()=>{
   await expect(db.query('SELECT delete_event($1)',[branchEvent])).rejects.toThrow('Event cannot be deleted');
 },async()=>{await db.query('UPDATE events SET start_at=now() WHERE id=$1',[branchEvent]);}));
 it('future published events without registrations can be deleted',async()=>transaction(ids.manager,async()=>{
   await db.query('SELECT delete_event($1)',[branchEvent]);
   await db.query('SELECT delete_event($1,true)',[branchEvent]);
   expect(await visible()).not.toContain(branchEvent);
 }));
 it('future published events with registrations cannot be deleted',async()=>transaction(ids.manager,async()=>{
   await expect(db.query('SELECT delete_event($1)',[branchEvent])).rejects.toThrow('Event cannot be deleted');
 },async()=>{await db.query("INSERT INTO event_registrations(event_id,status) VALUES($1,'confirmed')",[branchEvent]);}));
 it('cancelled events cannot be deleted',async()=>transaction(ids.manager,async()=>{
   await db.query('SELECT cancel_event($1)',[branchEvent]);
   await expect(db.query('SELECT delete_event($1)',[branchEvent])).rejects.toThrow('Event cannot be deleted');
 }));
 it('volunteer direct deletion and eligibility are denied',async()=>transaction(ids.volunteer,async()=>{
   expect((await db.query<{state:unknown}>('SELECT get_event_deletion_state($1) AS state',[branchEvent])).rows[0]?.state).toEqual({canManage:false,canDelete:false,pending:false,reason:null});
   await expect(db.query('SELECT delete_event($1)',[branchEvent])).rejects.toThrow('Not allowed');
 }));
 it('volunteers cannot finalize a manager deletion job',async()=>transaction(ids.manager,async()=>{
   await db.query('SELECT delete_event($1)',[draftEvent]);
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ids.volunteer]);
   await expect(db.query('SELECT delete_event($1,true)',[draftEvent])).rejects.toThrow('Not allowed');
 }));
 it('pending cleanup blocks uploads to already reserved paths',async()=>transaction(ids.manager,async()=>{
   const media=await add('image','png',draftEvent);
   await db.query('SELECT delete_event($1)',[draftEvent]);
   await expect(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('event-media',$1)",[`${draftEvent}/${media}.png`])).rejects.toThrow('row-level security');
 }));
 it('pending cleanup blocks edits and additional reservations',async()=>transaction(ids.manager,async()=>{
   await db.query('SELECT delete_event($1)',[draftEvent]);
   await expect(add('image','jpg',draftEvent)).rejects.toThrow('Not allowed');
 }));
 it('pending cleanup blocks cancellation',async()=>transaction(ids.manager,async()=>{
   await db.query('SELECT delete_event($1)',[draftEvent]);
   await expect(db.query('SELECT cancel_event($1)',[draftEvent])).rejects.toThrow('Not allowed');
 }));
 it('deletion RPC is authenticated-only and audit rows cannot be directly forged',async()=>{
   expect((await db.query("SELECT has_function_privilege('authenticated','delete_event(uuid,boolean)','EXECUTE') AS signed_in,has_function_privilege('anon','delete_event(uuid,boolean)','EXECUTE') AS anon,has_function_privilege('service_role','delete_event(uuid,boolean)','EXECUTE') AS service,has_table_privilege('authenticated','event_audit_log','INSERT') AS forge")).rows).toEqual([{signed_in:true,anon:false,service:false,forge:false}]);
 });
 it('active volunteers see published/cancelled branch events and regional events, not drafts or other branches',async()=>transaction(ids.volunteer,async()=>{expect(await visible()).toEqual([branchEvent,regionEvent].sort());}));
 it('branch managers also see drafts only in their own branch',async()=>transaction(ids.manager,async()=>{expect(await visible()).toEqual([branchEvent,draftEvent,regionEvent].sort());}));
 it('regional directors see every event in their region',async()=>transaction(ids.director,async()=>{expect(await visible()).toEqual([branchEvent,draftEvent,regionEvent,otherEvent].sort());}));
 it('users outside the region see none of these events',async()=>transaction(ids.outside,async()=>{expect(await visible()).toEqual([]);}));
 for(const status of ['pending','inactive']) it(`${status} users cannot view events`,async()=>transaction(ids.volunteer,async()=>{expect(await visible()).toEqual([]);},async()=>{await db.query('UPDATE profiles SET status=$1 WHERE id=$2',[status,ids.volunteer]);}));
 for(const status of ['pending','inactive']) it(`${status} managers cannot create events`,async()=>transaction(ids.manager,async()=>{await expect(create(data())).rejects.toThrow('Not allowed');},async()=>{await db.query('UPDATE profiles SET status=$1 WHERE id=$2',[status,ids.manager]);}));
 it('volunteers cannot create events',async()=>transaction(ids.volunteer,async()=>{await expect(create(data())).rejects.toThrow('Not allowed');}));
 it('branch managers can create in their own branch',async()=>transaction(ids.manager,async()=>{const id=await create(data());expect(await visible()).toContain(id);}));
 it('branch managers cannot create regional events',async()=>transaction(ids.manager,async()=>{await expect(create(data('region',null))).rejects.toThrow('Not allowed');}));
 it('branch managers cannot create in another branch',async()=>transaction(ids.manager,async()=>{await expect(create(data('branch',ids.branch2))).rejects.toThrow('Not allowed');}));
 it('directors cannot create outside their region',async()=>transaction(ids.director,async()=>{await expect(create(data('branch',ids.outsideBranch))).rejects.toThrow('Not allowed');}));
 it('branch managers cannot move an event to another branch',async()=>transaction(ids.manager,async()=>{await expect(db.query('SELECT update_event($1,$2::jsonb)',[branchEvent,JSON.stringify(data('branch',ids.branch2))])).rejects.toThrow('Not allowed');}));
 it('managers cancel their events without hiding them from volunteers',async()=>transaction(ids.manager,async()=>{await db.query('SELECT cancel_event($1)',[branchEvent]);expect((await db.query('SELECT status FROM events WHERE id=$1',[branchEvent])).rows).toEqual([{status:'cancelled'}]);await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ids.volunteer]);expect(await visible()).toContain(branchEvent);}));
 it('volunteers cannot cancel events',async()=>transaction(ids.volunteer,async()=>{await expect(db.query('SELECT cancel_event($1)',[branchEvent])).rejects.toThrow('Not allowed');}));
 it('rejects end times before start times',async()=>transaction(ids.manager,async()=>{await expect(create({...data(),end_at:'2027-01-01T17:59:00Z'})).rejects.toThrow('Invalid event dates or capacity');}));
 it('rejects zero capacity',async()=>transaction(ids.manager,async()=>{await expect(create({...data(),capacity:0})).rejects.toThrow('Invalid event dates or capacity');}));
 it('enforces five media slots and rejects the sixth on the server',async()=>transaction(ids.manager,async()=>{for(let i=0;i<5;i++)await add();expect((await db.query('SELECT count(*)::int AS count FROM event_media')).rows).toEqual([{count:5}]);await expect(add()).rejects.toThrow('Maximum 5 files');}));
 it('rejects unsupported media kinds/extensions',async()=>transaction(ids.manager,async()=>{await expect(add('image','svg')).rejects.toThrow('Invalid event file');}));
 it('normalizes a phone jpeg reservation to a jpg path',async()=>transaction(ids.manager,async()=>{const id=await add('image','jpeg');expect((await db.query('SELECT storage_path FROM event_media WHERE id=$1',[id])).rows).toEqual([{storage_path:`${branchEvent}/${id}.jpg`}]);}));
 it('volunteers cannot reserve uploads',async()=>transaction(ids.volunteer,async()=>{await expect(add()).rejects.toThrow('Not allowed');}));
 it('validates that reorder contains every attached id exactly once',async()=>transaction(ids.manager,async()=>{const a=await add(),b=await add();await expect(db.query('SELECT reorder_event_media($1,$2::uuid[])',[branchEvent,[a,a]])).rejects.toThrow('Invalid event file order');expect(b).not.toBe(a);}));
 it('first position is the cover and cannot be a PDF when an image exists',async()=>transaction(ids.manager,async()=>{const a=await add(),b=await add('pdf','pdf');await db.query('SELECT reorder_event_media($1,$2::uuid[])',[branchEvent,[a,b]]);expect((await db.query('SELECT id FROM event_media WHERE position=0')).rows).toEqual([{id:a}]);await expect(db.query('SELECT reorder_event_media($1,$2::uuid[])',[branchEvent,[b,a]])).rejects.toThrow('Cover must be an image');}));
 it('only reserved files can be uploaded and only visible events can be read',async()=>transaction(ids.manager,async()=>{const id=await add();const row=(await db.query<{storage_path:string}>('SELECT storage_path FROM event_media WHERE id=$1',[id])).rows[0];if(!row)throw new Error('No media');await db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('event-media',$1,$2)",[row.storage_path,JSON.stringify({mimetype:'image/jpeg',size:100})]);await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ids.volunteer]);expect((await db.query('SELECT name FROM storage.objects')).rows).toEqual([{name:row.storage_path}]);await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ids.other]);expect((await db.query('SELECT name FROM storage.objects')).rows).toEqual([]);}));
 it('allows reserved jpg, png and pdf uploads before Storage has populated metadata',async()=>transaction(ids.manager,async()=>{for(const extension of ['jpg','png','pdf']){const id=await add(extension==='pdf'?'pdf':'image',extension);const row=(await db.query<{storage_path:string}>('SELECT storage_path FROM event_media WHERE id=$1',[id])).rows[0];if(!row)throw new Error('No media');await db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('event-media',$1,$2)",[row.storage_path,'{}']);}expect((await db.query('SELECT count(*)::int AS count FROM storage.objects')).rows).toEqual([{count:3}]);}));
 it('removes a reserved media row after an upload failed before creating an object',async()=>transaction(ids.manager,async()=>{const id=await add();await db.query('SELECT delete_event_media($1)',[id]);expect((await db.query('SELECT id FROM event_media WHERE id=$1',[id])).rows).toEqual([]);}));
 it('storage rejects unreserved paths',async()=>transaction(ids.manager,async()=>{await expect(db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('event-media',$1,$2)",[`${branchEvent}/unreserved.jpg`,JSON.stringify({mimetype:'image/jpeg',size:100})])).rejects.toThrow('row-level security');}));
 it('stored objects must be deleted before their records and remaining positions compact',async()=>transaction(ids.manager,async()=>{const a=await add(),b=await add();await db.query('SELECT delete_event_media($1)',[a]);expect((await db.query('SELECT id,position FROM event_media')).rows).toEqual([{id:b,position:0}]);}));
 it('tables are read-only for authenticated users and inaccessible to anon',async()=>{for(const table of ['events','event_media']){const result=await db.query(`SELECT has_table_privilege('authenticated','${table}','SELECT') AS read,has_table_privilege('authenticated','${table}','INSERT') AS insert,has_table_privilege('authenticated','${table}','UPDATE') AS update,has_table_privilege('authenticated','${table}','DELETE') AS delete,has_table_privilege('anon','${table}','SELECT') AS anon`);expect(result.rows).toEqual([{read:true,insert:false,update:false,delete:false,anon:false}]);}});
 it('new callable functions have authenticated-only execution and trigger is not callable',async()=>{const result=await db.query<{name:string;anon:boolean;authenticated:boolean}>(`SELECT p.proname AS name,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_event','update_event','cancel_event','add_event_media','reorder_event_media','delete_event_media','can_view_event','can_manage_event','validate_event')`);expect(result.rows).toHaveLength(9);for(const row of result.rows){expect(row.anon).toBe(false);expect(row.authenticated).toBe(row.name!=='validate_event');}});
});
