-- New roles. In their own migration: a new enum value cannot be used in the transaction that adds it.
-- Ranking (low to high): follower < volunteer < branch_manager < regional_director < national_coordinator.
-- follower: everyone who signs up from now on (public events, own registrations and applications only).
-- national_coordinator: assigned only with SQL (docs/nc-setup.md), never in the app; needs an aal2 (MFA) session.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'follower';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'national_coordinator';
