-- Privacy notice 1.4 (branch trustees can see branch activity: meetings they are invited to, decisions, tasks and
-- member names). Every member confirms it once more: the confirmation screen appears until they accept 1.4
-- (require_privacy_accepted() refuses writes until then; account deletion stays exempt), and sign-up requires 1.4.
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.4' $$;
