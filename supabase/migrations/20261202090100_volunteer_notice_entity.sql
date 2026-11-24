-- Notices about a volunteer application (volunteer_application_approved / _declined, 20261202090000) point at the
-- application: entity_type 'volunteer_application' joins the allowed values.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('task', 'meeting', 'task_request', 'meeting_request', 'review', 'digest', 'volunteer_application'));
