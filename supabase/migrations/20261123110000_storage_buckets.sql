-- Storage buckets the app needs, created only when missing. Existing buckets are left exactly as they are
-- (production created event-media in the dashboard; event-request-files came with 20261123090000).
-- Limits follow the upload rules: event-media matches add_event_media and the event_files_upload policy;
-- event-request-files matches add_event_request_media and the event_request_files_upload policy.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('event-media', 'event-media', false, 10485760, ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('event-request-files', 'event-request-files', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;
