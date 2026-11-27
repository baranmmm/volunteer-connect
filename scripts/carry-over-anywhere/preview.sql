-- READ-ONLY preview of migration 20261222090000_carry_over_anywhere.sql. Run in the Supabase SQL editor on production.
-- It only SELECTs: no table, row or setting is changed.
--
-- The migration replaces the forward link meeting_agenda_items.carried_to (old item → its one copy) with
-- meeting_agenda_items.carried_from (copy → the item it was copied from), so an item can be carried into several
-- meetings. Every existing link is kept, read the other way. It stops and changes nothing if two items point to the
-- same copy (a copy can have only one source).
--
-- Rows: one per existing link: source meeting/item → copy meeting/item, the copy's state, and what the new
-- carry-over picker would offer for that chain (its latest copy, while unresolved and its meeting is not deleted).
-- The first row is the summary.
WITH RECURSIVE
links AS (
  SELECT a.id AS source_item, a.meeting_id AS source_meeting, a.title AS source_title,
         b.id AS copy_item, b.meeting_id AS copy_meeting, b.title AS copy_title, b.resolved AS copy_resolved,
         count(*) OVER (PARTITION BY a.carried_to) AS sources_of_copy
  FROM public.meeting_agenda_items a JOIN public.meeting_agenda_items b ON b.id = a.carried_to
),
-- The chains after the migration (carried_from = the source of each link), with each item's first item.
up AS (
  SELECT a.id, a.id AS root, l.source_item AS next, 0 AS depth
  FROM public.meeting_agenda_items a LEFT JOIN links l ON l.copy_item = a.id
  UNION ALL
  SELECT up.id, l0.id, l.source_item, up.depth + 1
  FROM up JOIN public.meeting_agenda_items l0 ON l0.id = up.next LEFT JOIN links l ON l.copy_item = l0.id
  WHERE up.depth < 200
),
rooted AS (SELECT DISTINCT ON (id) id, root FROM up ORDER BY id, depth DESC),
live AS (
  SELECT a.id, a.resolved, a.created_at, m.starts_at, r.root
  FROM public.meeting_agenda_items a JOIN public.meetings m ON m.id = a.meeting_id JOIN rooted r ON r.id = a.id
  WHERE m.deleted_at IS NULL
),
latest AS (
  SELECT DISTINCT ON (l.root) l.root, l.id, l.resolved
  FROM live l
  WHERE NOT EXISTS (SELECT 1 FROM links k JOIN live c ON c.id = k.copy_item WHERE k.source_item = l.id)
  ORDER BY l.root, l.created_at DESC, l.starts_at DESC, l.id DESC
),
label AS (
  SELECT m.id, m.title || ' (' || to_char(m.starts_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY') || ')'
           || CASE WHEN m.deleted_at IS NOT NULL THEN ' [deleted]' ELSE '' END AS meeting
  FROM public.meetings m
),
rows AS (
  SELECT 1 AS sort, ls.meeting AS source_meeting, k.source_title AS source_item, lc.meeting AS copy_meeting,
         k.copy_title AS copy_item,
         CASE WHEN k.copy_resolved THEN 'resolved' ELSE 'open' END AS copy_state,
         CASE WHEN k.sources_of_copy > 1 THEN 'CONFLICT: ' || k.sources_of_copy || ' items point to this copy'
              ELSE 'copy.carried_from = source' END AS change,
         CASE WHEN x.id IS NULL THEN 'not offered (no open latest copy)'
              WHEN x.resolved THEN 'not offered (latest copy resolved)'
              ELSE 'offered once, as ' || lx.meeting || ': ' || ix.title END AS picker,
         k.source_item AS source_item_id, k.copy_item AS copy_item_id
  FROM links k
  JOIN label ls ON ls.id = k.source_meeting JOIN label lc ON lc.id = k.copy_meeting
  JOIN rooted r ON r.id = k.copy_item
  LEFT JOIN latest x ON x.root = r.root
  LEFT JOIN public.meeting_agenda_items ix ON ix.id = x.id LEFT JOIN label lx ON lx.id = ix.meeting_id
)
SELECT * FROM (
  SELECT 0 AS sort,
         'SUMMARY' AS source_meeting,
         (SELECT count(*) FROM links) || ' links to convert' AS source_item,
         (SELECT count(*) FROM links WHERE sources_of_copy > 1) || ' conflicts' AS copy_meeting,
         NULL::text AS copy_item, NULL::text AS copy_state,
         CASE WHEN EXISTS (SELECT 1 FROM links WHERE sources_of_copy > 1) THEN 'MIGRATION WOULD STOP'
              ELSE 'migration would apply' END AS change,
         NULL::text AS picker, NULL::uuid AS source_item_id, NULL::uuid AS copy_item_id
  UNION ALL
  SELECT * FROM rows
) r
ORDER BY (sort = 0) DESC, source_meeting, source_item, copy_meeting;
