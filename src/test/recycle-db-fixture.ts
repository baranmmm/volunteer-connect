import type { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

/** Every migration (or, with `until`, only those before that file name, to test a migration on older data). */
export async function initializeRecycleDatabase(db: PGlite, options: { until?: string } = {}) {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('sub', nullif(current_setting('request.jwt.claim.sub',true),''),
      'aal', coalesce(nullif(current_setting('request.jwt.claim.aal',true),''), 'aal1'))$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT jsonb_build_object('privacy_notice_version', '${PRIVACY_VERSION}'));
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,storage,auth TO authenticated,anon;
    GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
    CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql AS $$SELECT reverse(split_part(reverse(name),'.',1))$$;
    CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $$BEGIN END$$;`);
  for (const file of readdirSync("supabase/migrations").sort()) {
    if (options.until && file >= options.until) break;
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  // Test-only (PGlite): sign-up needs a followed branch, and the older DB tests were written when a new account was a
  // pending volunteer. A fixture branch fills in a missing branch_id, and unless the metadata says "follower": true the
  // new follower is turned back into a pending volunteer (branch from the metadata). Real sign-up is tested with
  // "follower": true (roles-db.test.ts).
  await db.exec(`INSERT INTO public.regions(id, name) VALUES ('${FIXTURE_REGION}', 'Fixture Region');
    INSERT INTO public.branches(id, name, region_id) VALUES ('${FIXTURE_BRANCH}', 'Fixture Branch', '${FIXTURE_REGION}');
    CREATE FUNCTION public.fixture_signup_defaults() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NOT coalesce(NEW.raw_user_meta_data, '{}'::jsonb) ? 'branch_id' THEN
        NEW.raw_user_meta_data := coalesce(NEW.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('branch_id', '${FIXTURE_BRANCH}');
      END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER a_fixture_signup_defaults BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fixture_signup_defaults();
    CREATE FUNCTION public.fixture_legacy_member() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF coalesce(NEW.raw_user_meta_data->>'follower', '') <> 'true' THEN
        UPDATE public.user_roles SET role = 'volunteer' WHERE user_id = NEW.id AND role = 'follower';
        DELETE FROM public.user_followed_branches WHERE user_id = NEW.id;
        UPDATE public.profiles SET status = 'pending', branch_id = nullif(nullif(NEW.raw_user_meta_data->>'branch_id', ''), '${FIXTURE_BRANCH}')::uuid WHERE id = NEW.id;
      END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER zz_fixture_legacy_member AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fixture_legacy_member();`);
}

/** The privacy notice version the database requires (sign-up metadata must carry it). */
export const PRIVACY_VERSION = "1.5";
export const FIXTURE_REGION = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
export const FIXTURE_BRANCH = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
