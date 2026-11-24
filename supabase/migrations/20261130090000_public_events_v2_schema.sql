-- Public events v2 (replaces Eventbrite): schema.
-- * events: location "To be announced", places per registration, an iCalendar SEQUENCE counter and past-event records
--   (a manager adds an event that already took place, for the public "Past events" gallery).
-- * event_media: "Show in public gallery", the source URL of imported photos and the image size (masonry without
--   layout shift).
-- * event_registrations: guest registrations (no account) live in the same table as member registrations, so capacity
--   and the waitlist work the same; places per registration; status 'pending' = a guest has not confirmed their email.
--   The guest's personal data is in event_guests (no client access at all; managers read it through an RPC).
-- * subscribers: "Get event updates" with double opt-in.
-- * email_outbox: recipients without an account (guests, subscribers), priorities and the daily limit bookkeeping.
-- * event_videos: YouTube highlights (links only; the poster is stored by the server, so visitors load nothing from
--   YouTube before they click).
-- * public_rate_limits: per-IP / per-email counters for the signed-out forms.

ALTER TABLE public.events
  ADD COLUMN location_tba boolean NOT NULL DEFAULT false,
  ADD COLUMN max_places integer NOT NULL DEFAULT 1,
  ADD COLUMN ics_sequence integer NOT NULL DEFAULT 0,
  ADD COLUMN past_record boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT events_max_places_check CHECK (max_places BETWEEN 1 AND 10),
  ADD CONSTRAINT events_ics_sequence_check CHECK (ics_sequence >= 0);

ALTER TABLE public.event_media
  ADD COLUMN in_gallery boolean NOT NULL DEFAULT false,
  ADD COLUMN source_url text,
  ADD COLUMN width integer,
  ADD COLUMN height integer,
  ADD CONSTRAINT event_media_source_url_check CHECK (source_url IS NULL OR (char_length(source_url) <= 2000 AND source_url ~ '^https://')),
  ADD CONSTRAINT event_media_size_check CHECK ((width IS NULL OR width BETWEEN 1 AND 20000) AND (height IS NULL OR height BETWEEN 1 AND 20000)),
  ADD CONSTRAINT event_media_gallery_image CHECK (NOT in_gallery OR kind = 'image');
CREATE INDEX event_media_gallery_idx ON public.event_media (event_id) WHERE in_gallery;

ALTER TABLE public.event_registrations
  ADD COLUMN places integer NOT NULL DEFAULT 1,
  ADD COLUMN guest boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT event_registrations_places_check CHECK (places BETWEEN 1 AND 10),
  ADD CONSTRAINT event_registrations_guest_check CHECK (NOT guest OR (user_id IS NULL AND NOT show_name AND notice IS NULL)),
  ADD CONSTRAINT event_registrations_pending_guest CHECK (status <> 'pending' OR guest);
ALTER TABLE public.event_registrations DROP CONSTRAINT event_registrations_status_check;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_status_check
  CHECK (status IN ('pending', 'registered', 'waitlisted', 'cancelled', 'attended', 'no_show'));
CREATE INDEX event_registrations_guest_idx ON public.event_registrations (event_id) WHERE guest;

CREATE TABLE public.event_guests (
  registration_id uuid PRIMARY KEY REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text CHECK (phone IS NULL OR char_length(phone) BETWEEN 1 AND 40),
  keep_informed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_guests_event_email_key ON public.event_guests (event_id, email);
CREATE INDEX event_guests_email_idx ON public.event_guests (email);

CREATE TABLE public.subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 1 AND 120),
  -- Branch interest; NULL = every branch.
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  consent_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('landing', 'event_registration')),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  confirm_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscribers_active_idx ON public.subscribers (branch_id) WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

CREATE TABLE public.event_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('all', 'region', 'branch')),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  recipients integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_announcements_event_idx ON public.event_announcements (event_id);
CREATE INDEX event_announcements_created_by_idx ON public.event_announcements (created_by);

CREATE TABLE public.event_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = a channel highlight (imported), not tied to an event.
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  youtube_id text NOT NULL CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 300),
  thumb_path text UNIQUE CHECK (thumb_path IS NULL OR thumb_path ~ '^videos/[0-9a-f-]{36}\.jpg$'),
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_videos_event_youtube_key ON public.event_videos (coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid), youtube_id);
CREATE INDEX event_videos_event_idx ON public.event_videos (event_id);
CREATE INDEX event_videos_created_by_idx ON public.event_videos (created_by);

CREATE TABLE public.public_rate_limits (
  bucket text NOT NULL CHECK (char_length(bucket) <= 200),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Outbox: recipients without an account, priorities (1 transactional, 2 reminders, 3 announcements), claim bookkeeping.
ALTER TABLE public.email_outbox
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN to_email text CHECK (to_email IS NULL OR (to_email = lower(btrim(to_email)) AND char_length(to_email) <= 254)),
  ADD COLUMN registration_id uuid REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  ADD COLUMN subscriber_id uuid REFERENCES public.subscribers(id) ON DELETE CASCADE,
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN priority smallint NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  ADD COLUMN dedupe_key text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 300),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN not_before timestamptz,
  ADD CONSTRAINT email_outbox_recipient CHECK (user_id IS NOT NULL OR registration_id IS NOT NULL OR subscriber_id IS NOT NULL OR to_email IS NOT NULL);
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped'));
CREATE UNIQUE INDEX email_outbox_dedupe_key ON public.email_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX email_outbox_queue_idx ON public.email_outbox (priority, created_at, id) WHERE status = 'pending';
CREATE INDEX email_outbox_sent_idx ON public.email_outbox (sent_at) WHERE status = 'sent';
CREATE INDEX email_outbox_registration_idx ON public.email_outbox (registration_id) WHERE registration_id IS NOT NULL;
CREATE INDEX email_outbox_subscriber_idx ON public.email_outbox (subscriber_id) WHERE subscriber_id IS NOT NULL;
CREATE INDEX email_outbox_event_idx ON public.email_outbox (event_id) WHERE event_id IS NOT NULL;

-- No client access to any of the new tables: everything goes through RPCs (managers) or server code (service role).
ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_guests, public.subscribers, public.event_announcements, public.event_videos, public.public_rate_limits
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_guests, public.subscribers, public.event_announcements, public.event_videos, public.public_rate_limits
  TO service_role;
CREATE POLICY event_guests_service ON public.event_guests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY subscribers_service ON public.subscribers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY event_announcements_service ON public.event_announcements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY event_videos_service ON public.event_videos FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY public_rate_limits_service ON public.public_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
