CREATE TABLE public.api_call_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  key_fingerprint text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_call_logs TO authenticated;
GRANT ALL ON public.api_call_logs TO service_role;

ALTER TABLE public.api_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_call_logs_admin_select"
  ON public.api_call_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX api_call_logs_created_at_idx ON public.api_call_logs (created_at DESC);
CREATE INDEX api_call_logs_endpoint_idx ON public.api_call_logs (endpoint);