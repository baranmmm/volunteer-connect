-- Captured test emails (EMAIL_TRANSPORT=capture, the e2e app server only) are marked sent without a send time, so they
-- never use up the daily sending limit of a long local test session. Retention still removes them (by created_at).
CREATE OR REPLACE FUNCTION public.capture_email(p_id uuid, p_rendered jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.email_outbox SET status = 'sent', sent_at = NULL, claimed_at = NULL, last_error = NULL,
    payload = payload || jsonb_build_object('captured', coalesce(p_rendered, '{}'::jsonb))
  WHERE id = p_id AND status = 'sending';
END $$;
REVOKE ALL ON FUNCTION public.capture_email(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_email(uuid, jsonb) TO service_role;
