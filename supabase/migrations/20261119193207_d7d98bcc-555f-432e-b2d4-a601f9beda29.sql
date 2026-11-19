ALTER TYPE public.user_audit_action ADD VALUE IF NOT EXISTS 'user_deleted';
ALTER TYPE public.user_audit_action ADD VALUE IF NOT EXISTS 'deletion_requested';
ALTER TYPE public.user_audit_action ADD VALUE IF NOT EXISTS 'deletion_cancelled';

CREATE TYPE public.deletion_request_status AS ENUM ('pending','cancelled','completed');

CREATE TABLE public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status public.deletion_request_status NOT NULL DEFAULT 'pending',
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at timestamptz
);
CREATE UNIQUE INDEX account_deletion_one_pending ON public.account_deletion_requests(user_id) WHERE status = 'pending';
REVOKE ALL ON public.account_deletion_requests FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users and managers read deletion requests" ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_user(auth.uid(), user_id));

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _me uuid := auth.uid(); _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM id FROM public.profiles WHERE id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF public.has_role(_me, 'regional_director') THEN
    RAISE EXCEPTION 'Regional Directors must contact the Dialogue Society office to delete their account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE user_id = _me AND status = 'pending') THEN
    RAISE EXCEPTION 'You already have a pending deletion request';
  END IF;
  INSERT INTO public.account_deletion_requests(user_id) VALUES (_me) RETURNING id INTO _id;
  INSERT INTO public.user_audit_log(actor_id, target_id, action) VALUES (_me, _me, 'deletion_requested');
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.account_deletion_requests SET status = 'cancelled', handled_by = _me, handled_at = now()
   WHERE user_id = _me AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending deletion request'; END IF;
  INSERT INTO public.user_audit_log(actor_id, target_id, action) VALUES (_me, _me, 'deletion_cancelled');
END $$;

-- Called only by the delete-user Edge Function (service role) before deleting the auth user.
CREATE OR REPLACE FUNCTION public.authorize_user_deletion(_actor uuid, _target uuid, _request uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _status public.profile_status;
BEGIN
  IF _actor IS NULL OR _target IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot delete your own account here'; END IF;
  IF public.has_role(_target, 'regional_director') THEN RAISE EXCEPTION 'Regional Directors cannot be deleted'; END IF;
  IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
  SELECT status INTO _status FROM public.profiles WHERE id = _target;
  IF _request IS NULL THEN
    IF _status IS DISTINCT FROM 'inactive' THEN RAISE EXCEPTION 'Deactivate the user first'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE id = _request AND user_id = _target AND status = 'pending') THEN
    RAISE EXCEPTION 'This deletion request is no longer pending';
  END IF;
END $$;

-- Called only by the Edge Function after the auth user was deleted. No personal data is stored.
CREATE OR REPLACE FUNCTION public.record_user_deletion(_actor uuid, _target uuid, _request uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'user_deleted', NULL, NULL);
  IF _request IS NOT NULL THEN
    UPDATE public.account_deletion_requests SET status = 'completed', handled_by = _actor, handled_at = now() WHERE id = _request;
  END IF;
  -- Any other pending request for this user is completed by the deletion too.
  UPDATE public.account_deletion_requests SET status = 'completed', handled_by = _actor, handled_at = now()
   WHERE status = 'pending' AND user_id IS NULL AND handled_at IS NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.request_account_deletion(), public.cancel_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(), public.cancel_account_deletion() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.authorize_user_deletion(uuid, uuid, uuid), public.record_user_deletion(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_user_deletion(uuid, uuid, uuid), public.record_user_deletion(uuid, uuid, uuid) TO service_role;