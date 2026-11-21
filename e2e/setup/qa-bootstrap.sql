-- QA-only bootstrap. Applied by setup/migrate.ts ONLY when public.rls_auto_enable() is missing.
--
-- Migration 20261119171822 runs `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated`.
-- The function is created by Supabase's "Enable RLS on new tables automatically" option (and exists on
-- the Lovable-managed production project), but no migration creates it. On a project without it,
-- `supabase db push` would fail, so we create an equivalent function here. Migration files stay untouched.
--
-- Only the function is created. No event trigger is attached: every migration enables RLS explicitly,
-- and creating event triggers may require privileges the postgres role does not have.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
      AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon;
