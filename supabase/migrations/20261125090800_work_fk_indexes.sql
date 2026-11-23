-- Indexes for the foreign keys added with tasks, meetings and notifications (and the volunteer_applications cascade).
-- Deleting a user, branch, region, event, meeting or decision runs the ON DELETE action on every referencing table;
-- without an index on the referencing column each action is a sequential scan of that table. The existing partial
-- indexes (WHERE deleted_at IS NULL / IS NOT NULL) cannot serve these checks, because deleted rows reference too.
-- Indexes only: no data, policy, grant or function changes.

CREATE INDEX IF NOT EXISTS notifications_actor_idx ON public.notifications (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_outbox_user_idx ON public.email_outbox (user_id);
CREATE INDEX IF NOT EXISTS email_outbox_notification_idx ON public.email_outbox (notification_id) WHERE notification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS meetings_created_by_idx ON public.meetings (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS meetings_deleted_by_idx ON public.meetings (deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS meeting_invitees_invited_by_idx ON public.meeting_invitees (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS meeting_decisions_meeting_idx ON public.meeting_decisions (meeting_id);
CREATE INDEX IF NOT EXISTS meeting_decisions_created_by_idx ON public.meeting_decisions (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS meeting_files_created_by_idx ON public.meeting_files (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS meeting_requests_branch_idx ON public.meeting_requests (branch_id);
CREATE INDEX IF NOT EXISTS meeting_requests_region_idx ON public.meeting_requests (region_id);
CREATE INDEX IF NOT EXISTS meeting_requests_meeting_idx ON public.meeting_requests (meeting_id) WHERE meeting_id IS NOT NULL;

-- tasks_branch_idx / tasks_region_idx are partial (not deleted); branch and region deletes also check deleted tasks.
CREATE INDEX IF NOT EXISTS tasks_branch_all_idx ON public.tasks (branch_id);
CREATE INDEX IF NOT EXISTS tasks_region_all_idx ON public.tasks (region_id);
CREATE INDEX IF NOT EXISTS tasks_created_by_idx ON public.tasks (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_deleted_by_idx ON public.tasks (deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_meeting_idx ON public.tasks (meeting_id) WHERE meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_assignees_assigned_by_idx ON public.task_assignees (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_reminder_log_user_idx ON public.task_reminder_log (user_id);
CREATE INDEX IF NOT EXISTS task_requests_branch_idx ON public.task_requests (branch_id);
CREATE INDEX IF NOT EXISTS task_requests_region_idx ON public.task_requests (region_id);
CREATE INDEX IF NOT EXISTS task_requests_task_idx ON public.task_requests (task_id) WHERE task_id IS NOT NULL;

-- Cascades with its branch since 20261125090000.
CREATE INDEX IF NOT EXISTS volunteer_applications_branch_idx ON public.volunteer_applications (branch_id);
