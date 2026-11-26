-- Trustee role (approved by the user, 2026-11-26). In its own migration: a new enum value cannot be used in the
-- transaction that adds it. The rules are in 20261210090100_trustee_role.sql.
-- trustee: a branch-level, read-only member. Not a step on the volunteer -> branch manager ladder; it sits beside
-- volunteer (follower < volunteer | trustee < branch_manager < regional_director < national_coordinator).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trustee';
