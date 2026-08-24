-- Roles
CREATE TYPE public.app_role AS ENUM ('employee','manager','finance','admin');
CREATE TYPE public.request_status AS ENUM ('draft','pending_manager','pending_finance','approved','rejected','cancelled');
CREATE TYPE public.approval_stage AS ENUM ('manager','finance');
CREATE TYPE public.approval_decision AS ENUM ('pending','approved','rejected');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  department text,
  manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_manager_of(_manager uuid, _employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _employee AND manager_id = _manager)
$$;

CREATE TABLE public.travel_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL UNIQUE,
  max_trip_days integer NOT NULL DEFAULT 7,
  max_ticket_price numeric(12,2) NOT NULL DEFAULT 800,
  max_hotel_per_night numeric(12,2) NOT NULL DEFAULT 180,
  per_diem numeric(12,2) NOT NULL DEFAULT 60,
  finance_review_threshold numeric(12,2) NOT NULL DEFAULT 3000,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.travel_policies TO authenticated;
GRANT ALL ON public.travel_policies TO service_role;
ALTER TABLE public.travel_policies ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.travel_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destination text NOT NULL,
  purpose text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  transportation_type text NOT NULL DEFAULT 'flight',
  transportation_cost numeric(12,2) NOT NULL DEFAULT 0,
  hotel_name text,
  hotel_nightly_rate numeric(12,2) NOT NULL DEFAULT 0,
  hotel_nights integer NOT NULL DEFAULT 0,
  per_diem_rate numeric(12,2) NOT NULL DEFAULT 0,
  other_costs numeric(12,2) NOT NULL DEFAULT 0,
  total_budget numeric(12,2) NOT NULL DEFAULT 0,
  needs_booking_help boolean NOT NULL DEFAULT false,
  policy_violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  exception_justification text,
  status public.request_status NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.travel_requests TO authenticated;
GRANT ALL ON public.travel_requests TO service_role;
ALTER TABLE public.travel_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.request_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.travel_requests(id) ON DELETE CASCADE,
  stage public.approval_stage NOT NULL,
  decision public.approval_decision NOT NULL DEFAULT 'pending',
  approver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  comment text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_approvals TO authenticated;
GRANT ALL ON public.request_approvals TO service_role;
ALTER TABLE public.request_approvals ENABLE ROW LEVEL SECURITY;

-- Policies: profiles
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_admin_update" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Policies: user_roles
CREATE POLICY "roles_select_all" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_write" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Policies: travel_policies
CREATE POLICY "policies_select_all" ON public.travel_policies FOR SELECT TO authenticated USING (true);
CREATE POLICY "policies_admin_write" ON public.travel_policies FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Policies: travel_requests
CREATE POLICY "requests_select_own" ON public.travel_requests FOR SELECT TO authenticated USING (auth.uid() = requester_id);
CREATE POLICY "requests_select_manager" ON public.travel_requests FOR SELECT TO authenticated USING (public.is_manager_of(auth.uid(), requester_id));
CREATE POLICY "requests_select_reviewers" ON public.travel_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'finance') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "requests_insert_own" ON public.travel_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "requests_update_own" ON public.travel_requests FOR UPDATE TO authenticated USING (auth.uid() = requester_id) WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "requests_update_manager" ON public.travel_requests FOR UPDATE TO authenticated USING (public.is_manager_of(auth.uid(), requester_id)) WITH CHECK (public.is_manager_of(auth.uid(), requester_id));
CREATE POLICY "requests_update_reviewers" ON public.travel_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'finance') OR public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'finance') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "requests_delete_own_draft" ON public.travel_requests FOR DELETE TO authenticated USING (auth.uid() = requester_id AND status = 'draft');

-- Policies: request_approvals
CREATE POLICY "approvals_select" ON public.request_approvals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.travel_requests r WHERE r.id = request_id AND (
    r.requester_id = auth.uid()
    OR public.is_manager_of(auth.uid(), r.requester_id)
    OR public.has_role(auth.uid(),'finance')
    OR public.has_role(auth.uid(),'admin')))
);
CREATE POLICY "approvals_insert" ON public.request_approvals FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.travel_requests r WHERE r.id = request_id AND (
    r.requester_id = auth.uid()
    OR public.is_manager_of(auth.uid(), r.requester_id)
    OR public.has_role(auth.uid(),'finance')
    OR public.has_role(auth.uid(),'admin')))
);
CREATE POLICY "approvals_update" ON public.request_approvals FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.travel_requests r WHERE r.id = request_id AND (
    public.is_manager_of(auth.uid(), r.requester_id)
    OR public.has_role(auth.uid(),'finance')
    OR public.has_role(auth.uid(),'admin')))
) WITH CHECK (true);

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_requests_updated BEFORE UPDATE ON public.travel_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- New user bootstrap: profile + default employee role; first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count integer;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''));
  SELECT count(*) INTO user_count FROM public.profiles;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'admin'), (NEW.id,'employee');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'employee');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.travel_policies (role, max_trip_days, max_ticket_price, max_hotel_per_night, per_diem, finance_review_threshold) VALUES
  ('employee', 7, 800, 180, 60, 3000),
  ('manager', 10, 1200, 250, 80, 5000),
  ('finance', 10, 1200, 250, 80, 5000),
  ('admin', 14, 2500, 400, 100, 10000);