-- Notices without profile row locks (fixes "deadlock detected" under concurrency).
--
-- 20261128090000 made notify() and review_notice_refresh() take FOR KEY SHARE on the recipient's profile, so that a
-- recipient deleted at that moment could not make the notice (and the action behind it) fail on the foreign key. But
-- request, approval and role functions lock profiles FOR UPDATE; two of them notifying each other's reviewers in the
-- opposite order deadlocked. Now:
-- * no profile row locks: a recipient deleted at that moment makes the notice insert fail on the foreign key, which is
--   caught in a subtransaction and simply skipped (the action still succeeds);
-- * no SELECT ... FOR UPDATE on the grouped notice (the UPDATE takes its own short lock);
-- * reviewers are refreshed in one fixed order (by id), so two triggers never lock the same notices in opposite order.

CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _entity_type text, _entity_id uuid, _title text, _link text,
  _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _type text := public.notification_type(_kind); _setting jsonb; _branch text;
BEGIN
  IF _user IS NULL OR _user IS NOT DISTINCT FROM auth.uid() THEN RETURN NULL; END IF;
  -- Replaced by the grouped "waiting for you" notice (review_notice_refresh).
  IF _kind IN ('task_request_received', 'meeting_request_received') THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND status = 'active' AND deleted_at IS NULL) THEN RETURN NULL; END IF;
  _setting := public.notification_setting(_user, _type);
  IF NOT (_setting->>'enabled')::boolean THEN RETURN NULL; END IF;
  _branch := CASE _entity_type
    WHEN 'task' THEN (SELECT b.name FROM public.tasks t JOIN public.branches b ON b.id = t.branch_id WHERE t.id = _entity_id)
    WHEN 'meeting' THEN (SELECT b.name FROM public.meetings m JOIN public.branches b ON b.id = m.branch_id WHERE m.id = _entity_id) END;
  BEGIN
    INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload, held)
    VALUES (_user, _kind, auth.uid(), _entity_type, _entity_id, left(coalesce(_title, ''), 300), _link,
      coalesce(_payload, '{}'::jsonb) || CASE WHEN _branch IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('branch', _branch) END,
      _setting->>'delivery' = 'digest')
    RETURNING id INTO _id;
  EXCEPTION WHEN foreign_key_violation THEN
    -- The recipient (or the actor) was deleted at this very moment: no notice, the action itself goes on.
    RETURN NULL;
  END;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.review_notice_refresh(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w jsonb; _id uuid; _total text;
BEGIN
  IF _user IS NULL OR NOT public.is_active_person(_user) THEN RETURN; END IF;
  _w := public.review_waiting_for(_user);
  BEGIN
    IF (_w->>'total')::integer = 0 THEN
      DELETE FROM public.notifications WHERE user_id = _user AND kind = 'review_waiting' AND read_at IS NULL;
      RETURN;
    END IF;
    SELECT id, payload->>'total' INTO _id, _total FROM public.notifications
    WHERE user_id = _user AND kind = 'review_waiting' AND read_at IS NULL ORDER BY created_at DESC LIMIT 1;
    IF _id IS NULL THEN
      INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload)
      VALUES (_user, 'review_waiting', NULL, 'review', _user, '', '/requests?tab=review', _w);
    ELSIF _total IS DISTINCT FROM _w->>'total' THEN
      UPDATE public.notifications SET payload = _w, created_at = now() WHERE id = _id;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN;  -- the reviewer was deleted at this very moment
  END;
END $$;

CREATE OR REPLACE FUNCTION public.event_requests_review_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOR _u IN SELECT x FROM (SELECT public.scope_reviewers(NEW.scope, NEW.branch_id, NEW.region_id) AS x
      UNION SELECT public.scope_reviewers(OLD.scope, OLD.branch_id, OLD.region_id) WHERE TG_OP = 'UPDATE') r
    ORDER BY x LOOP
    PERFORM public.review_notice_refresh(_u);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.volunteer_applications_review_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOR _u IN SELECT x FROM (SELECT public.scope_reviewers('branch', b.id, b.region_id) AS x FROM public.branches b
      WHERE b.id = NEW.branch_id) r ORDER BY x LOOP
    PERFORM public.review_notice_refresh(_u);
  END LOOP;
  RETURN NULL;
END $$;
