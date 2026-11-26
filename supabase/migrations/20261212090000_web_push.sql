-- Web Push: a third notice channel next to "In the app" and "Email" (on top of 20261208090100 / 20261208090200).
--
-- Before: notices reach a member in the app (notifications) and by email (email_outbox, notice / daily_digest).
-- After:
-- * push_subscriptions: one row per browser/device that turned push on (endpoint UNIQUE, the two RFC 8291 keys
--   p256dh and auth, a short device label such as "Chrome on Android", created_at, last_used_at). user_id references
--   profiles ON DELETE CASCADE: a subscription is the person's own device address and means nothing without them (like
--   notification_preferences); a soft delete (profiles.deleted_at set) removes them at once (trigger), the Auth
--   erasure removes the profile and so the rest. At most 10 per person (the oldest goes).
-- * push_outbox: what the server still has to send, one row per (notice, subscription). Like email_outbox it is
--   rendered at send time from the notice (generic title per kind, no item titles or names) and is never read by
--   clients. Pending rows older than a day expire (push is about now); finished rows are deleted after 7 days.
-- * Per type a "push" switch next to "enabled" (in the app) and "email" (notification_preferences.types->type->push).
--   Defaults: ON for task_assigned (incl. task_group_created), review (requests waiting for my review) and meeting
--   (invitations, changes, cancellations); OFF for every other type. Off = nothing queued, and pending pushes of that
--   type are skipped.
-- * notify() (as in 20261208090100) and review_notice_refresh() (as in 20261208090100) also queue the pushes for the
--   recipient's devices when the type's push is on: every kind of the type at once (the grouped review notice when it
--   is created or its count goes up, like its email). Queueing never makes the notice or the action fail.
-- * Client RPCs (authenticated, SECURITY DEFINER, own rows only, each starting with require_privacy_accepted):
--   register_push_subscription, unregister_push_subscription, list_my_push_subscriptions, set_notification_push.
--   Volunteers and up, NCs included (followers get no notices: refused). No table grants to anon/authenticated at
--   all: nobody (NCs included) reads another person's subscriptions; clients see only their own devices' labels
--   through the list RPC, never endpoints or keys.
-- * Server (service role only): claim_push_batch, finish_push ('gone' = the push service answered 404/410: the
--   subscription is deleted).
-- Additive: two new tables, new functions; notify(), review_notice_refresh() and notification_setting() replaced with
-- the same signatures and grants (notification_setting gains the 'push' key). No existing data is changed.

-- ---------------------------------------------------------------------------------------------------------------
-- Tables

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://[^[:space:]]+$' AND length(endpoint) <= 2048),
  -- base64url without padding: p256dh = 65 bytes (uncompressed P-256 point), auth = 16 bytes.
  p256dh text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{22}$'),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id);

CREATE TABLE public.push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  not_before timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
-- One waiting push per notice and device (a review notice whose count goes up reuses it: rendered at send time).
CREATE UNIQUE INDEX push_outbox_pending_once ON public.push_outbox (notification_id, subscription_id) WHERE status = 'pending';
CREATE INDEX push_outbox_pending_idx ON public.push_outbox (created_at) WHERE status = 'pending';
CREATE INDEX push_outbox_subscription_idx ON public.push_outbox (subscription_id);
CREATE INDEX push_outbox_user_idx ON public.push_outbox (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions, public.push_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_subscriptions, public.push_outbox TO service_role;
-- No policy for clients: every client access goes through the RPCs below (own rows only).

-- A soft-deleted person's devices stop at once (restoring the account does not bring them back: push is turned on
-- again on the device).
CREATE FUNCTION public.push_subscriptions_profile_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.push_subscriptions WHERE user_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER push_subscriptions_profile_deleted AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION public.push_subscriptions_profile_deleted();

-- ---------------------------------------------------------------------------------------------------------------
-- Push on/off per type

CREATE FUNCTION public.notification_push_default(_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _type IN ('task_assigned', 'review', 'meeting')
$$;

CREATE FUNCTION public.notification_push_on(_user uuid, _type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _type IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided')
    AND coalesce((SELECT (p.types->_type->>'push')::boolean FROM public.notification_preferences p WHERE p.user_id = _user),
      public.notification_push_default(_type))
$$;

-- One person's setting for a type: { enabled (in the app), email, push }. As in 20261208090100, plus push.
CREATE OR REPLACE FUNCTION public.notification_setting(_user uuid, _type text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', public.notification_type_locked(_type)
      OR coalesce((SELECT (p.types->_type->>'enabled')::boolean FROM public.notification_preferences p WHERE p.user_id = _user), true),
    'email', public.notification_email_on(_user, _type),
    'push', public.notification_push_on(_user, _type))
$$;

-- Profile > Notifications: push on/off for any type (locked ones included; they stay on in the app). Off skips that
-- type's pushes still waiting.
CREATE FUNCTION public.set_notification_push(p_type text, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok()
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_type IS NULL OR p_on IS NULL
    OR p_type NOT IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO public.notification_preferences (user_id, types)
  VALUES (auth.uid(), jsonb_build_object(p_type, jsonb_build_object('push', p_on)))
  ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
    || jsonb_build_object(p_type, coalesce(public.notification_preferences.types->p_type, '{}'::jsonb) || jsonb_build_object('push', p_on)),
    updated_at = now();
  IF NOT p_on THEN
    UPDATE public.push_outbox SET status = 'skipped', last_error = 'push_off'
    WHERE user_id = auth.uid() AND status = 'pending' AND type = p_type;
  END IF;
  RETURN public.notification_setting(auth.uid(), p_type) || jsonb_build_object('type', p_type);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Devices (client RPCs, own rows only)

-- Turns push on for this device (or refreshes its keys). An endpoint belongs to one browser: when another member signs
-- in on the same browser and turns push on, the device moves to them and the previous owner's waiting pushes for it
-- are dropped.
CREATE FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _row public.push_subscriptions; _previous uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _me IS NULL OR NOT public.session_ok() OR public.is_follower(_me)
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _me AND status = 'active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://[^[:space:]]+$' OR length(p_endpoint) > 2048
    OR p_p256dh IS NULL OR p_p256dh !~ '^[A-Za-z0-9_-]{87}$' OR p_auth IS NULL OR p_auth !~ '^[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION 'Invalid push subscription';
  END IF;
  SELECT user_id INTO _previous FROM public.push_subscriptions WHERE endpoint = p_endpoint FOR UPDATE;
  IF _previous IS NOT NULL AND _previous <> _me THEN
    DELETE FROM public.push_outbox o USING public.push_subscriptions s
    WHERE o.subscription_id = s.id AND s.endpoint = p_endpoint AND o.status = 'pending';
  END IF;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (_me, p_endpoint, p_p256dh, p_auth, nullif(left(btrim(coalesce(p_user_agent, '')), 60), ''))
  ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    created_at = CASE WHEN public.push_subscriptions.user_id = EXCLUDED.user_id THEN public.push_subscriptions.created_at ELSE now() END,
    last_used_at = CASE WHEN public.push_subscriptions.user_id = EXCLUDED.user_id THEN public.push_subscriptions.last_used_at END
  RETURNING * INTO _row;
  -- At most 10 devices per person: the least recently used go.
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE user_id = _me
    ORDER BY coalesce(last_used_at, created_at) DESC, created_at DESC OFFSET 10);
  RETURN jsonb_build_object('id', _row.id, 'created_at', _row.created_at);
END $$;

-- Turns push off for this device (by endpoint) or for one of my other devices (by id). Own rows only.
CREATE FUNCTION public.unregister_push_subscription(p_endpoint text DEFAULT NULL, p_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_endpoint IS NULL AND p_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.push_subscriptions
  WHERE user_id = auth.uid() AND (endpoint = p_endpoint OR id = p_id);
  RETURN FOUND;
END $$;

-- My devices with push on: label and dates only (never the endpoint or keys); `current` marks the device whose
-- endpoint is passed (this browser).
CREATE FUNCTION public.list_my_push_subscriptions(p_endpoint text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'user_agent', s.user_agent, 'created_at', s.created_at,
      'last_used_at', s.last_used_at, 'current', p_endpoint IS NOT NULL AND s.endpoint = p_endpoint)
      ORDER BY s.created_at DESC, s.id)
    FROM public.push_subscriptions s WHERE s.user_id = auth.uid()), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Queueing

-- Internal: one push per device of the recipient when the type's push is on. Never fails the notice: any error (a
-- device removed at this very moment) just means no push.
CREATE FUNCTION public.queue_push(_user uuid, _notification uuid, _type text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR _notification IS NULL OR NOT public.notification_push_on(_user, _type) THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.push_outbox (user_id, subscription_id, notification_id, type)
    SELECT _user, s.id, _notification, _type FROM public.push_subscriptions s WHERE s.user_id = _user
    ON CONFLICT (notification_id, subscription_id) WHERE status = 'pending' DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
END $$;

-- notify(): as in 20261208090100, plus the push queue.
CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _entity_type text, _entity_id uuid, _title text, _link text,
  _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _type text := public.notification_type(_kind); _setting jsonb; _branch text;
  _mode text := public.notification_email_mode(_kind);
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
    INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload, held, email_digest)
    VALUES (_user, _kind, auth.uid(), _entity_type, _entity_id, left(coalesce(_title, ''), 300), _link,
      coalesce(_payload, '{}'::jsonb) || CASE WHEN _branch IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('branch', _branch) END,
      false, _mode = 'digest' AND (_setting->>'email')::boolean)
    RETURNING id INTO _id;
    IF _mode = 'immediate' THEN PERFORM public.queue_notice_email(_user, _id, _type); END IF;
    IF (_setting->>'push')::boolean THEN PERFORM public.queue_push(_user, _id, _type); END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    -- The recipient (or the actor) was deleted at this very moment: no notice, the action itself goes on.
    RETURN NULL;
  END;
  RETURN _id;
END $$;

-- The grouped review notice (as in 20261208090100): an email and a push when it is created or its count goes up.
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
      VALUES (_user, 'review_waiting', NULL, 'review', _user, '', '/requests?tab=review', _w)
      RETURNING id INTO _id;
      PERFORM public.queue_notice_email(_user, _id, 'review');
      PERFORM public.queue_push(_user, _id, 'review');
    ELSIF _total IS DISTINCT FROM _w->>'total' THEN
      UPDATE public.notifications SET payload = _w, created_at = now() WHERE id = _id;
      IF (_w->>'total')::integer > coalesce(nullif(_total, '')::integer, 0) THEN
        PERFORM public.queue_notice_email(_user, _id, 'review');
        PERFORM public.queue_push(_user, _id, 'review');
      END IF;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN;  -- the reviewer was deleted at this very moment
  END;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Sending (service role only)

-- Claims up to p_max waiting pushes (oldest first) with what the sender needs: the device (endpoint, keys) and the
-- notice (kind, payload, link) and the member's language. Pushes that no longer apply are skipped here: the notice was
-- read or removed, the member is no longer active, the type is off in the app or for push. Also: a crashed run's claims
-- return after 5 minutes, pending pushes older than a day expire, finished rows older than 7 days are deleted.
CREATE FUNCTION public.claim_push_batch(p_max integer DEFAULT 50)
RETURNS TABLE (id uuid, endpoint text, p256dh text, auth text, attempts integer, kind text, payload jsonb, link text,
  notification_id uuid, language text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('push_outbox_claim'));
  UPDATE public.push_outbox o SET status = 'pending', claimed_at = NULL
  WHERE o.status = 'sending' AND o.claimed_at < now() - interval '5 minutes';
  UPDATE public.push_outbox o SET status = 'skipped', last_error = 'expired'
  WHERE o.status = 'pending' AND o.created_at < now() - interval '1 day';
  DELETE FROM public.push_outbox o WHERE o.id IN (SELECT x.id FROM public.push_outbox x
    WHERE x.status IN ('sent', 'skipped', 'failed') AND x.created_at < now() - interval '7 days' LIMIT 1000);
  UPDATE public.push_outbox o SET status = 'skipped', last_error = 'no_longer_applies'
  FROM public.notifications n, public.profiles p
  WHERE o.status = 'pending' AND n.id = o.notification_id AND p.id = o.user_id
    AND (n.read_at IS NOT NULL OR p.status <> 'active' OR p.deleted_at IS NOT NULL
      OR NOT (public.notification_setting(o.user_id, o.type) @> '{"enabled": true, "push": true}'::jsonb));
  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM public.push_outbox o
    WHERE o.status = 'pending' AND coalesce(o.not_before, '-infinity') <= now()
    ORDER BY o.created_at, o.id LIMIT least(greatest(coalesce(p_max, 50), 0), 100) FOR UPDATE SKIP LOCKED),
  claimed AS (
    UPDATE public.push_outbox o SET status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    FROM picked WHERE o.id = picked.id RETURNING o.*)
  SELECT c.id, s.endpoint, s.p256dh, s.auth, c.attempts, n.kind, n.payload, n.link, n.id, p.preferred_language::text
  FROM claimed c
  JOIN public.push_subscriptions s ON s.id = c.subscription_id
  JOIN public.notifications n ON n.id = c.notification_id
  JOIN public.profiles p ON p.id = c.user_id
  ORDER BY c.created_at, c.id;
END $$;

-- The sender's result: 'sent', 'retry' (rate limit, push service error, network: back-off attempts x 2 minutes,
-- 'failed' after 5 attempts), 'failed' (refused for good), 'gone' (404/410: the device's subscription is deleted, and
-- with it its waiting pushes).
CREATE FUNCTION public.finish_push(p_id uuid, p_result text, p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o public.push_outbox;
BEGIN
  SELECT * INTO _o FROM public.push_outbox WHERE id = p_id FOR UPDATE;
  IF _o.id IS NULL THEN RETURN; END IF;
  IF p_result = 'sent' THEN
    UPDATE public.push_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = p_id;
    UPDATE public.push_subscriptions SET last_used_at = now() WHERE id = _o.subscription_id;
  ELSIF p_result = 'gone' THEN
    DELETE FROM public.push_subscriptions WHERE id = _o.subscription_id;
  ELSIF p_result = 'retry' AND _o.attempts < 5 THEN
    UPDATE public.push_outbox SET status = 'pending', claimed_at = NULL, last_error = left(p_error, 200),
      not_before = now() + make_interval(mins => 2 * greatest(_o.attempts, 1)) WHERE id = p_id;
  ELSE
    UPDATE public.push_outbox SET status = 'failed', last_error = left(coalesce(p_error, p_result), 200) WHERE id = p_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.push_subscriptions_profile_deleted(), public.notification_push_default(text),
  public.notification_push_on(uuid, text), public.notification_setting(uuid, text), public.queue_push(uuid, uuid, text),
  public.notify(uuid, text, text, uuid, text, text, jsonb), public.review_notice_refresh(uuid),
  public.claim_push_batch(integer), public.finish_push(uuid, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(integer), public.finish_push(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.set_notification_push(text, boolean), public.register_push_subscription(text, text, text, text),
  public.unregister_push_subscription(text, uuid), public.list_my_push_subscriptions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_notification_push(text, boolean), public.register_push_subscription(text, text, text, text),
  public.unregister_push_subscription(text, uuid), public.list_my_push_subscriptions(text) TO authenticated;
