REVOKE EXECUTE ON FUNCTION public.can_manage_deleted_user(uuid,uuid) FROM authenticated;
CREATE INDEX user_deletion_state_audit_idx ON public.user_deletion_state(deletion_audit_id);