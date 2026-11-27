-- READ-ONLY preview of the carry-over repair (migration 20261221090000_carry_over_shared_tasks.sql).
-- Run in the Supabase SQL editor on production. It only SELECTs: no table, row or setting is changed.
--
-- For every agenda item that was carried over (meeting_agenda_items.carried_to):
--   * copy decisions  = decisions of the new item created in the carry-over transaction (created_at = the new item's
--                       created_at); decisions added to the new meeting later are not copies.
--   * originals       = decisions of the old item that existed before the carry-over.
--   * match method    = "single decision" when the old item had one decision and one was copied; otherwise
--                       "identical text" when exactly one original has the copy's exact text and no other copy
--                       has it too (only within this item pair); otherwise UNMATCHED.
-- Every task and "@all" group now on a copy decision walks back along the matches while it is older than the decision
-- it is on: it returns to the decision where it was created. One created after the copy stays on the copy.
-- The first row is the summary; the migration stops (and changes nothing) when it shows any unmatched copy or work.
WITH RECURSIVE
pairs AS (
  SELECT a.id AS src_item, a.meeting_id AS src_meeting, b.id AS copy_item, b.meeting_id AS copy_meeting,
         b.created_at AS carried_at, b.title AS item_title
  FROM public.meeting_agenda_items a JOIN public.meeting_agenda_items b ON b.id = a.carried_to
),
copies AS (
  SELECT p.*, d.id AS copy_decision, d.text AS copy_text, d.created_at AS copy_created
  FROM pairs p JOIN public.meeting_decisions d ON d.agenda_item_id = p.copy_item AND d.created_at = p.carried_at
),
originals AS (
  SELECT p.src_item, d.id AS orig_decision, d.text AS orig_text
  FROM pairs p JOIN public.meeting_decisions d ON d.agenda_item_id = p.src_item AND d.created_at < p.carried_at
),
sizes AS (
  SELECT p.src_item,
         (SELECT count(*) FROM copies c WHERE c.src_item = p.src_item) AS n_copies,
         (SELECT count(*) FROM originals o WHERE o.src_item = p.src_item) AS n_originals
  FROM pairs p
),
same_text AS (
  SELECT c.copy_decision, o.orig_decision
  FROM copies c JOIN originals o ON o.src_item = c.src_item AND o.orig_text = c.copy_text
),
unique_text AS (
  SELECT s.copy_decision, s.orig_decision FROM same_text s
  WHERE (SELECT count(*) FROM same_text x WHERE x.copy_decision = s.copy_decision) = 1
    AND (SELECT count(*) FROM same_text x WHERE x.orig_decision = s.orig_decision) = 1
),
matched AS (
  SELECT c.*,
         CASE WHEN z.n_copies = 1 AND z.n_originals = 1 THEN (SELECT o.orig_decision FROM originals o WHERE o.src_item = c.src_item)
              ELSE (SELECT u.orig_decision FROM unique_text u WHERE u.copy_decision = c.copy_decision) END AS orig_decision,
         CASE WHEN z.n_copies = 1 AND z.n_originals = 1 THEN 'single decision'
              WHEN EXISTS (SELECT 1 FROM unique_text u WHERE u.copy_decision = c.copy_decision) THEN 'identical text'
              ELSE 'UNMATCHED' END AS method
  FROM copies c JOIN sizes z USING (src_item)
),
-- Work on a copy decision: tasks without a group, and "@all" groups (their member tasks follow the group).
work AS (
  SELECT 'task' AS kind, t.id, t.title, t.status::text AS status, t.created_at, t.decision_id, t.deleted_at IS NOT NULL AS deleted,
         NULL::bigint AS members
  FROM public.tasks t WHERE t.group_id IS NULL AND t.decision_id IN (SELECT copy_decision FROM copies)
  UNION ALL
  SELECT 'group', g.id, g.title, NULL, g.created_at, g.decision_id, false,
         (SELECT count(*) FROM public.tasks m WHERE m.group_id = g.id AND m.deleted_at IS NULL)
  FROM public.task_groups g WHERE g.decision_id IN (SELECT copy_decision FROM copies)
),
walk AS (
  SELECT w.kind, w.id, w.created_at AS work_created, w.decision_id AS at_decision, d.created_at AS at_created, 0 AS depth
  FROM work w JOIN public.meeting_decisions d ON d.id = w.decision_id
  UNION ALL
  SELECT k.kind, k.id, k.work_created, m.orig_decision, d.created_at, k.depth + 1
  FROM walk k
  JOIN matched m ON m.copy_decision = k.at_decision AND m.orig_decision IS NOT NULL
  JOIN public.meeting_decisions d ON d.id = m.orig_decision
  WHERE k.work_created < k.at_created
),
final AS (
  SELECT DISTINCT ON (kind, id) kind, id, at_decision, at_created, work_created, depth
  FROM walk ORDER BY kind, id, depth DESC
),
plan AS (
  SELECT w.kind, w.id, w.title, w.status, w.deleted, w.members, w.created_at, m.*,
         CASE WHEN f.work_created < f.at_created THEN 'UNMATCHED'
              WHEN f.depth = 0 THEN 'stays on the copy (created after the copy)'
              ELSE 'moves back' END AS action,
         CASE WHEN f.work_created < f.at_created THEN NULL ELSE f.at_decision END AS target_decision
  FROM work w JOIN final f ON f.kind = w.kind AND f.id = w.id JOIN matched m ON m.copy_decision = w.decision_id
),
label AS (
  SELECT d.id AS decision, mt.title || ' (' || to_char(mt.starts_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY') || ')'
           || CASE WHEN mt.deleted_at IS NOT NULL THEN ' [deleted]' ELSE '' END AS meeting,
         left(replace(d.text, E'\n', ' / '), 80) AS text
  FROM public.meeting_decisions d JOIN public.meetings mt ON mt.id = d.meeting_id
),
rows AS (
  -- One row per copy decision (with or without work), then one per task or group on it.
  SELECT 1 AS sort, m.item_title, lo.meeting AS original_meeting, lo.text AS original_decision, m.orig_decision AS original_decision_id,
         lc.meeting AS copy_meeting, lc.text AS copy_decision, m.copy_decision AS copy_decision_id, m.method,
         'decision' AS kind, NULL::text AS work_title, NULL::text AS work_detail, NULL::text AS currently_on,
         NULL::text AS goes_to, CASE WHEN m.method = 'UNMATCHED' THEN 'UNMATCHED' ELSE 'linked (carried_from)' END AS action,
         NULL::uuid AS work_id
  FROM matched m LEFT JOIN label lo ON lo.decision = m.orig_decision JOIN label lc ON lc.decision = m.copy_decision
  UNION ALL
  SELECT 2, p.item_title, lo.meeting, lo.text, p.orig_decision, lc.meeting, lc.text, p.copy_decision, p.method,
         p.kind, p.title,
         concat_ws(', ', p.status, CASE WHEN p.members IS NOT NULL THEN p.members || ' member tasks' END,
                   CASE WHEN p.deleted THEN 'in Recycle Bin' END,
                   'created ' || to_char(p.created_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI')),
         lc.meeting || ': ' || lc.text, lt.meeting || ': ' || lt.text, p.action, p.id
  FROM plan p LEFT JOIN label lo ON lo.decision = p.orig_decision JOIN label lc ON lc.decision = p.copy_decision
  LEFT JOIN label lt ON lt.decision = p.target_decision
)
SELECT * FROM (
SELECT 0 AS sort, 'SUMMARY' AS item_title,
       (SELECT count(*) FROM pairs) || ' carried items, ' || (SELECT count(*) FROM matched) || ' copied decisions ('
         || (SELECT count(*) FROM matched WHERE method = 'single decision') || ' single decision, '
         || (SELECT count(*) FROM matched WHERE method = 'identical text') || ' identical text, '
         || (SELECT count(*) FROM matched WHERE method = 'UNMATCHED') || ' unmatched)' AS original_meeting,
       (SELECT count(*) FROM plan WHERE kind = 'task' AND action = 'moves back') || ' tasks and '
         || (SELECT count(*) FROM plan WHERE kind = 'group' AND action = 'moves back') || ' groups move back; '
         || (SELECT count(*) FROM plan WHERE action LIKE 'stays%') || ' stay on the copy; '
         || (SELECT count(*) FROM plan WHERE action = 'UNMATCHED') || ' unmatched' AS original_decision,
       NULL::uuid AS original_decision_id, NULL::text AS copy_meeting, NULL::text AS copy_decision,
       NULL::uuid AS copy_decision_id, NULL::text AS method, 'summary'::text AS kind, NULL::text AS work_title,
       NULL::text AS work_detail, NULL::text AS currently_on, NULL::text AS goes_to,
       CASE WHEN EXISTS (SELECT 1 FROM matched WHERE method = 'UNMATCHED') OR EXISTS (SELECT 1 FROM plan WHERE action = 'UNMATCHED')
            THEN 'MIGRATION WOULD STOP' ELSE 'migration would apply' END AS action,
       NULL::uuid AS work_id
UNION ALL
SELECT * FROM rows
) r
ORDER BY (sort = 0) DESC, original_meeting, item_title, copy_decision_id, sort, kind, work_title;
