CREATE TYPE public.app_role AS ENUM ('regional_director','branch_manager','volunteer');
CREATE TYPE public.profile_status AS ENUM ('pending','active','inactive');

CREATE TABLE public.regions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE public.branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, region_id uuid NOT NULL REFERENCES public.regions(id));
GRANT SELECT ON public.regions, public.branches TO anon, authenticated;
GRANT ALL ON public.regions, public.branches TO service_role;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
-- anon read needed for the sign-up branch dropdown (public, non-sensitive)
CREATE POLICY "Anyone can read regions" ON public.regions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can read branches" ON public.branches FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  phone text,
  branch_id uuid REFERENCES public.branches(id),
  status public.profile_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  region_id uuid REFERENCES public.regions(id),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.get_user_branch(_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM public.profiles WHERE id = _user_id
$$;
CREATE OR REPLACE FUNCTION public.get_user_region(_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT region_id FROM public.user_roles WHERE user_id = _user_id AND role = 'regional_director' AND region_id IS NOT NULL LIMIT 1),
    (SELECT b.region_id FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id WHERE p.id = _user_id)
  )
$$;
-- can _actor manage _target? (not self)
CREATE OR REPLACE FUNCTION public.can_manage_user(_actor uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _actor <> _target AND (
    (public.has_role(_actor,'branch_manager') AND public.get_user_branch(_actor) IS NOT NULL
      AND public.get_user_branch(_target) = public.get_user_branch(_actor))
    OR
    (public.has_role(_actor,'regional_director') AND EXISTS (
      SELECT 1 FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id
      WHERE p.id = _target AND b.region_id = (SELECT region_id FROM public.user_roles WHERE user_id = _actor AND role='regional_director' LIMIT 1)))
  )
$$;

CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Managers read managed profiles" ON public.profiles FOR SELECT TO authenticated USING (public.can_manage_user(auth.uid(), id));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Managers read managed roles" ON public.user_roles FOR SELECT TO authenticated USING (public.can_manage_user(auth.uid(), user_id));

-- Status changes go through this function only
CREATE OR REPLACE FUNCTION public.set_user_status(_target uuid, _status public.profile_status) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_user(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.profiles SET status = _status WHERE id = _target;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_user_status(uuid, public.profile_status) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_status(uuid, public.profile_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid;
BEGIN
  BEGIN _branch := NULLIF(NEW.raw_user_meta_data->>'branch_id','')::uuid; EXCEPTION WHEN others THEN _branch := NULL; END;
  IF _branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch) THEN _branch := NULL; END IF;
  INSERT INTO public.profiles (id, full_name, email, phone, branch_id, status)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone', _branch, 'pending');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'volunteer');
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

WITH r AS (
  INSERT INTO public.regions (name) VALUES ('Greater London'),('North of England'),('South of England'),('Midlands'),('East Midlands'),('Wales') RETURNING id, name
)
INSERT INTO public.branches (name, region_id)
SELECT b.name, r.id FROM r JOIN (VALUES
 ('Greater London','London'),('Greater London','Bexley'),('Greater London','Croydon'),('Greater London','Kingston'),('Greater London','Sutton'),
 ('North of England','Hull'),('North of England','Leeds'),('North of England','Liverpool'),('North of England','Manchester'),('North of England','North East'),('North of England','Sheffield'),('North of England','Worksop'),
 ('South of England','Brighton'),('South of England','Bristol'),('South of England','Oxford'),('South of England','Medway'),('South of England','Reading'),('South of England','Basingstoke'),
 ('Midlands','Birmingham'),('Midlands','Northampton'),('East Midlands','Leicester'),('Wales','Cardiff')
) AS b(region, name) ON b.region = r.name;