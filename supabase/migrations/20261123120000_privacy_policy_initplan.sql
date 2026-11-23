-- The privacy check in the RESTRICTIVE policies runs once per query, not once per row: wrapping the call in a
-- scalar sub-select lets Postgres evaluate it as an initplan (same rule, much cheaper on large event lists).
ALTER POLICY privacy_notice_required ON public.events USING ((SELECT public.has_accepted_privacy_notice()));
ALTER POLICY privacy_notice_required ON public.event_series USING ((SELECT public.has_accepted_privacy_notice()));
ALTER POLICY privacy_notice_required ON public.event_media USING ((SELECT public.has_accepted_privacy_notice()));
ALTER POLICY privacy_notice_required ON public.event_registrations USING ((SELECT public.has_accepted_privacy_notice()));
ALTER POLICY privacy_notice_required ON public.event_requests USING ((SELECT public.has_accepted_privacy_notice()));
