-- Privacy notice 1.1 (followed branches, volunteer applications, public events). Every member confirms it once more:
-- the confirmation screen appears until they accept 1.1, and sign-up requires 1.1.
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.1' $$;
