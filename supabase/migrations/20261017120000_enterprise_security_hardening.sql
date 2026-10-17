-- Enterprise security hardening:
-- * RLS on organizations, org_members, user_roles, automation_runs, guardian_event_activity
-- * pending AWS mutation approvals
-- * rate_limit_entries
-- * per-customer AssumeRole ExternalId on stored credentials

-- ── rate limit table (used by guardian-scheduler and user-facing functions) ──
CREATE TABLE IF NOT EXISTS public.rate_limit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_entries_key_window_idx
  ON public.rate_limit_entries (key, window_start DESC);

ALTER TABLE public.rate_limit_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages rate_limit_entries" ON public.rate_limit_entries;
CREATE POLICY "Service role manages rate_limit_entries"
  ON public.rate_limit_entries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── pending AWS mutation approvals (UI click, not chat text) ──
CREATE TABLE IF NOT EXISTS public.pending_aws_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service text NOT NULL,
  operation text NOT NULL,
  tool_name text NOT NULL DEFAULT 'execute_aws_api',
  action_hash text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversation_id uuid,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  rejected_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_aws_actions_user_status_idx
  ON public.pending_aws_actions (user_id, status, expires_at DESC);

ALTER TABLE public.pending_aws_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own pending AWS actions" ON public.pending_aws_actions;
CREATE POLICY "Users can view own pending AWS actions"
  ON public.pending_aws_actions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users cannot insert pending AWS actions" ON public.pending_aws_actions;
-- Inserts happen only via service role (edge functions). Authenticated users may read.
CREATE POLICY "Users cannot insert pending AWS actions"
  ON public.pending_aws_actions FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Service role manages pending AWS actions" ON public.pending_aws_actions;
CREATE POLICY "Service role manages pending AWS actions"
  ON public.pending_aws_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── stored credential columns for ExternalId + vault key version ──
ALTER TABLE public.stored_aws_credentials
  ADD COLUMN IF NOT EXISTS encrypted_external_id text,
  ADD COLUMN IF NOT EXISTS encryption_key_version text NOT NULL DEFAULT 'v1';

ALTER TABLE public.stored_aws_credentials
  ALTER COLUMN encrypted_access_key_id DROP NOT NULL;

ALTER TABLE public.stored_aws_credentials
  ALTER COLUMN encrypted_secret_access_key DROP NOT NULL;

-- ── RLS: organizations ──
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view organizations" ON public.organizations;
CREATE POLICY "Org members can view organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_org_member(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Creators can insert organizations" ON public.organizations;
CREATE POLICY "Creators can insert organizations"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Owners can update organizations" ON public.organizations;
CREATE POLICY "Owners can update organizations"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), id) = 'owner')
  WITH CHECK (public.get_org_role(auth.uid(), id) = 'owner');

DROP POLICY IF EXISTS "Service role full access on organizations" ON public.organizations;
CREATE POLICY "Service role full access on organizations"
  ON public.organizations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── RLS: org_members ──
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view memberships in their orgs" ON public.org_members;
CREATE POLICY "Users can view memberships in their orgs"
  ON public.org_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member(auth.uid(), org_id)
  );

DROP POLICY IF EXISTS "Owners and admins can insert org members" ON public.org_members;
CREATE POLICY "Owners and admins can insert org members"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    public.get_org_role(auth.uid(), org_id) IN ('owner', 'admin')
    OR (
      -- Allow the first membership insert for an org the user just created
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = org_id AND o.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Owners and admins can update org members" ON public.org_members;
CREATE POLICY "Owners and admins can update org members"
  ON public.org_members FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), org_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), org_id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "Owners and admins can delete org members" ON public.org_members;
CREATE POLICY "Owners and admins can delete org members"
  ON public.org_members FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), org_id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "Service role full access on org_members" ON public.org_members;
CREATE POLICY "Service role full access on org_members"
  ON public.org_members FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── RLS: user_roles ──
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users cannot modify roles" ON public.user_roles;
CREATE POLICY "Users cannot modify roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Service role full access on user_roles" ON public.user_roles;
CREATE POLICY "Service role full access on user_roles"
  ON public.user_roles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── RLS: automation_runs ──
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own automation runs" ON public.automation_runs;
CREATE POLICY "Users can view own automation runs"
  ON public.automation_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own automation runs" ON public.automation_runs;
CREATE POLICY "Users can insert own automation runs"
  ON public.automation_runs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access on automation_runs" ON public.automation_runs;
CREATE POLICY "Service role full access on automation_runs"
  ON public.automation_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── RLS: guardian_event_activity ──
ALTER TABLE public.guardian_event_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own guardian activity" ON public.guardian_event_activity;
CREATE POLICY "Users can view own guardian activity"
  ON public.guardian_event_activity FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access on guardian_event_activity" ON public.guardian_event_activity;
CREATE POLICY "Service role full access on guardian_event_activity"
  ON public.guardian_event_activity FOR ALL TO service_role
  USING (true) WITH CHECK (true);
