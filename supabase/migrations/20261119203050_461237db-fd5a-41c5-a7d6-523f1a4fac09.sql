ALTER TABLE public.profiles
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'en'
  CONSTRAINT profiles_preferred_language_check CHECK (preferred_language IN ('en','tr'));

GRANT UPDATE (preferred_language) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _branch uuid;
  _lang text := NEW.raw_user_meta_data->>'preferred_language';
BEGIN
  BEGIN _branch := NULLIF(NEW.raw_user_meta_data->>'branch_id','')::uuid; EXCEPTION WHEN others THEN _branch := NULL; END;
  IF _branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch) THEN _branch := NULL; END IF;
  IF _lang IS NULL OR _lang NOT IN ('en','tr') THEN _lang := 'en'; END IF;
  INSERT INTO public.profiles (id, full_name, email, phone, branch_id, status, preferred_language)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone', _branch, 'pending', _lang);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'volunteer');
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;