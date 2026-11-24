-- Test transport for the email sender: when the app server runs with EMAIL_TRANSPORT=capture (the e2e app server,
-- never production), a claimed email is rendered but not sent; the rendered subject, text, HTML and attachment names
-- are kept on the outbox row (payload.captured) so tests can read links from the email itself. Counts as sent.
CREATE FUNCTION public.capture_email(p_id uuid, p_rendered jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.email_outbox SET status = 'sent', sent_at = now(), claimed_at = NULL, last_error = NULL,
    payload = payload || jsonb_build_object('captured', coalesce(p_rendered, '{}'::jsonb))
  WHERE id = p_id AND status = 'sending';
END $$;
REVOKE ALL ON FUNCTION public.capture_email(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_email(uuid, jsonb) TO service_role;
