-- Follow-up to 20261017120000:
-- * Bind pending AWS actions to stored credential/account/region
-- * Atomic rate_limit_hit RPC with unique (key, window_bucket)
-- * org_members: only owners may manage owner/admin rows; protect last owner
-- * SET search_path on SECURITY DEFINER membership helpers

-- ── pending_aws_actions: bind credential + account ──
ALTER TABLE public.pending_aws_actions
  ADD COLUMN IF NOT EXISTS credential_id uuid,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS region text;

-- ── rate limiter: unique bucket + atomic hit ──
ALTER TABLE public.rate_limit_entries
  ADD COLUMN IF NOT EXISTS window_bucket timestamptz;

UPDATE public.rate_limit_entries
SET window_bucket = date_trunc('minute', window_start)
WHERE window_bucket IS NULL;

DELETE FROM public.rate_limit_entries a
USING public.rate_limit_entries b
WHERE a.window_bucket IS NOT NULL
  AND b.window_bucket IS NOT NULL
  AND a.key = b.key
  AND a.window_bucket = b.window_bucket
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_entries_key_bucket_uidx
  ON public.rate_limit_entries (key, window_bucket);

CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, request_count integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket timestamptz;
  cnt integer;
  window_secs integer;
BEGIN
  window_secs := GREATEST(COALESCE(p_window_seconds, 60), 1);
  bucket := to_timestamp(floor(extract(epoch from now()) / window_secs) * window_secs);
  INSERT INTO public.rate_limit_entries (key, window_start, window_bucket, request_count)
  VALUES (p_key, now(), bucket, 1)
  ON CONFLICT (key, window_bucket)
  DO UPDATE SET request_count = public.rate_limit_entries.request_count + 1
  RETURNING public.rate_limit_entries.request_count INTO cnt;

  allowed := cnt <= GREATEST(COALESCE(p_max, 1), 1);
  request_count := cnt;
  retry_after_seconds := window_secs;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_entries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.rate_limit_entries
  WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limit_entries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_entries() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cloudpilot-cleanup-rate-limit-entries',
      '20 * * * *',
      $cron$SELECT public.cleanup_rate_limit_entries();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ── membership helpers: pin search_path ──
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = _user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_org_role(_user_id UUID, _org_id UUID)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.app_role;
BEGIN
  SELECT role INTO _role FROM public.org_members
  WHERE org_id = _org_id AND user_id = _user_id;
  RETURN _role;
END;
$$;

-- ── org_members: owners manage privileged roles; admins only member/viewer ──
DROP POLICY IF EXISTS "Owners and admins can insert org members" ON public.org_members;
DROP POLICY IF EXISTS "Owners and admins can update org members" ON public.org_members;
DROP POLICY IF EXISTS "Owners and admins can delete org members" ON public.org_members;
DROP POLICY IF EXISTS "Owners can insert privileged org members" ON public.org_members;
DROP POLICY IF EXISTS "Admins can insert member and viewer org members" ON public.org_members;
DROP POLICY IF EXISTS "Creators can insert first owner membership" ON public.org_members;
DROP POLICY IF EXISTS "Owners can update org members" ON public.org_members;
DROP POLICY IF EXISTS "Admins can update member and viewer org members" ON public.org_members;
DROP POLICY IF EXISTS "Owners can delete org members except last owner" ON public.org_members;
DROP POLICY IF EXISTS "Admins can delete member and viewer org members" ON public.org_members;

CREATE POLICY "Creators can insert first owner membership"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = org_id AND o.created_by = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = org_id
    )
  );

CREATE POLICY "Owners can insert privileged org members"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    public.get_org_role(auth.uid(), org_id) = 'owner'
  );

CREATE POLICY "Admins can insert member and viewer org members"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    public.get_org_role(auth.uid(), org_id) = 'admin'
    AND role IN ('member', 'viewer')
  );

CREATE POLICY "Owners can update org members"
  ON public.org_members FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), org_id) = 'owner')
  WITH CHECK (public.get_org_role(auth.uid(), org_id) = 'owner');

CREATE POLICY "Admins can update member and viewer org members"
  ON public.org_members FOR UPDATE TO authenticated
  USING (
    public.get_org_role(auth.uid(), org_id) = 'admin'
    AND role IN ('member', 'viewer')
  )
  WITH CHECK (
    public.get_org_role(auth.uid(), org_id) = 'admin'
    AND role IN ('member', 'viewer')
  );

CREATE POLICY "Owners can delete org members except last owner"
  ON public.org_members FOR DELETE TO authenticated
  USING (
    public.get_org_role(auth.uid(), org_id) = 'owner'
    AND NOT (
      role = 'owner'
      AND (
        SELECT count(*) FROM public.org_members m
        WHERE m.org_id = org_members.org_id AND m.role = 'owner'
      ) <= 1
    )
  );

CREATE POLICY "Admins can delete member and viewer org members"
  ON public.org_members FOR DELETE TO authenticated
  USING (
    public.get_org_role(auth.uid(), org_id) = 'admin'
    AND role IN ('member', 'viewer')
  );
