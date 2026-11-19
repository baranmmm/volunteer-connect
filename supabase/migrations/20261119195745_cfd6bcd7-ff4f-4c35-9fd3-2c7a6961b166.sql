ALTER TYPE public.user_audit_action ADD VALUE IF NOT EXISTS 'user_deletion_failed';
ALTER TABLE public.account_deletion_requests ADD COLUMN deletion_audit_id uuid REFERENCES public.user_audit_log(id) ON DELETE SET NULL;
CREATE INDEX account_deletion_requests_deletion_audit_idx ON public.account_deletion_requests(deletion_audit_id);

DROP FUNCTION public.authorize_user_deletion(uuid, uuid, uuid);
CREATE FUNCTION public.authorize_user_deletion(_actor uuid, _target uuid, _request uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _status public.profile_status; _audit uuid;
BEGIN
  IF _actor IS NULL OR _target IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot delete your own account here'; END IF;
  IF public.has_role(_target, 'regional_director') THEN RAISE EXCEPTION 'Regional Directors cannot be deleted'; END IF;
  IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
  SELECT status INTO _status FROM public.profiles WHERE id = _target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _request IS NULL THEN
    IF _status IS DISTINCT FROM 'inactive' THEN RAISE EXCEPTION 'Deactivate the user first'; END IF;
  ELSE
    PERFORM id FROM public.account_deletion_requests WHERE id = _request AND user_id = _target AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This deletion request is no longer pending'; END IF;
  END IF;
  INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value)
    VALUES (_actor, _target, 'user_deleted', NULL, NULL) RETURNING id INTO _audit;
  UPDATE public.account_deletion_requests SET deletion_audit_id = _audit
    WHERE user_id = _target AND status = 'pending';
  RETURN _audit;
END $$;

DROP FUNCTION public.record_user_deletion(uuid, uuid, uuid);
CREATE FUNCTION public.record_user_deletion(_actor uuid, _target uuid, _audit uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_audit_log WHERE id = _audit AND actor_id = _actor AND target_id = _target AND action = 'user_deleted') THEN
    RAISE EXCEPTION 'Invalid deletion audit entry';
  END IF;
  UPDATE public.account_deletion_requests SET status = 'completed', handled_by = _actor, handled_at = now()
    WHERE deletion_audit_id = _audit AND status = 'pending';
END $$;

CREATE FUNCTION public.record_user_deletion_failure(_actor uuid, _target uuid, _audit uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_audit_log WHERE id = _audit AND actor_id = _actor AND target_id = _target AND action = 'user_deleted') THEN
    RAISE EXCEPTION 'Invalid deletion audit entry';
  END IF;
  INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value)
    VALUES (_actor, _target, 'user_deletion_failed', NULL, NULL);
  UPDATE public.account_deletion_requests SET status = 'pending', handled_by = NULL, handled_at = NULL, deletion_audit_id = NULL
    WHERE deletion_audit_id = _audit;
END $$;
REVOKE EXECUTE ON FUNCTION public.authorize_user_deletion(uuid, uuid, uuid), public.record_user_deletion(uuid, uuid, uuid), public.record_user_deletion_failure(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_user_deletion(uuid, uuid, uuid), public.record_user_deletion(uuid, uuid, uuid), public.record_user_deletion_failure(uuid, uuid, uuid) TO service_role;