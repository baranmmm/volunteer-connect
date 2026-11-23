-- Privacy notice 1.2 (tasks, meetings, task/meeting requests, notices and task reminder emails). Every member confirms
-- it once more: the confirmation screen appears until they accept 1.2 (require_privacy_accepted() refuses writes
-- until then; account deletion stays exempt), and sign-up requires 1.2.
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.2' $$;
