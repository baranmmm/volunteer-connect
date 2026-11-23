import type { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

export async function initializeRecycleDatabase(db: PGlite) {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{"privacy_notice_version":"1.0"}'::jsonb);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,storage,auth TO authenticated,anon;
    GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
    CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql AS $$SELECT reverse(split_part(reverse(name),'.',1))$$;
    CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $$BEGIN END$$;`);
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
}