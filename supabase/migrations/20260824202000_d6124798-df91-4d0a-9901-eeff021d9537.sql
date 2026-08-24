ALTER TABLE public.travel_policies
  ADD COLUMN IF NOT EXISTS event_types text[] NOT NULL DEFAULT ARRAY['client meeting','conference','training','internal team meeting','site visit','customer onboarding','sales / business development']::text[];

ALTER TABLE public.travel_requests
  ADD COLUMN IF NOT EXISTS ai_review jsonb,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz;