-- Privacy notice 1.5 (push notifications, optional: a technical address per device the member turns push on for,
-- deleted when push is turned off on that device, on sign-out there, or with the account; 20261212090000). Every member
-- confirms it once more: the confirmation screen appears until they accept 1.5 (require_privacy_accepted() refuses
-- writes until then; account deletion stays exempt), and sign-up requires 1.5.
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.5' $$;
