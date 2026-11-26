-- Task note @mentions push by default (user decision 2026-11-26). Before, push was on by default only for
-- task_assigned, review and meeting, so a mentioned member got the in-app notice but no push unless they turned it on
-- in Profile > Notifications > Advanced. notification_push_on() reads a saved per-type choice first and falls back to
-- this default, so members who saved an explicit push choice for 'mention' keep it.
-- Only notification_push_default changes (same signature; no grant, as before). The lock-screen text stays generic
-- (src/lib/push/payload.ts: "You were mentioned in a task note", never the task title or a name). No table or data change.

CREATE OR REPLACE FUNCTION public.notification_push_default(_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _type IN ('task_assigned', 'mention', 'review', 'meeting')
$$;

REVOKE ALL ON FUNCTION public.notification_push_default(text) FROM PUBLIC, anon, authenticated;
