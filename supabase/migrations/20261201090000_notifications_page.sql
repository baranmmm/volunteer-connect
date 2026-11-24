-- Notifications page (/notifications): the caller's own notices, read and unread, one page at a time. A keyset cursor
-- on (created_at, id) newest first: pass the last row's created_at and id to get the next page. Same columns, filters
-- (own rows, not held for a daily summary, MFA session for NCs, privacy notice) and actor-name join as
-- list_my_notifications; the limit is capped at 100. Read-only.

CREATE FUNCTION public.list_my_notifications_page(
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 30
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) FROM (
    SELECT n.id, n.kind, n.entity_type, n.entity_id, n.title, n.link, n.payload, n.created_at, n.read_at, n.digest_id,
      CASE WHEN a.deleted_at IS NULL THEN a.full_name END AS actor_name
    FROM public.notifications n LEFT JOIN public.profiles a ON a.id = n.actor_id
    WHERE n.user_id = auth.uid() AND NOT n.held AND public.session_ok() AND public.has_accepted_privacy_notice()
      AND (p_before IS NULL
        OR n.created_at < p_before
        OR (n.created_at = p_before AND p_before_id IS NOT NULL AND n.id < p_before_id))
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT greatest(1, least(coalesce(p_limit, 30), 100))) x
$$;

REVOKE ALL ON FUNCTION public.list_my_notifications_page(timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_notifications_page(timestamptz, uuid, integer) TO authenticated;
