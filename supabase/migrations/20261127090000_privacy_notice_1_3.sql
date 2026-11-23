-- Privacy notice 1.3 (task notes and @mentions, reminders only when turned on, meetings in the calendar). Every member
-- confirms it once more: the confirmation screen appears until they accept 1.3 (require_privacy_accepted() refuses
-- writes until then; account deletion stays exempt), and sign-up requires 1.3.
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.3' $$;
