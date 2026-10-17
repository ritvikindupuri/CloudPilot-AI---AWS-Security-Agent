-- Follow-up to 20261017200000:
-- * Supabase ALTER DEFAULT PRIVILEGES grants EXECUTE on new functions to
--   anon/authenticated even after REVOKE FROM PUBLIC. Explicitly revoke.
-- * Rate-limit RPCs are service_role only (PostgREST anon must not lock out cron).
-- * is_org_member / get_org_role are not callable by anon (membership probe).
-- * Qualify org_members.org_id in the first-owner INSERT policy.
-- * Owners cannot demote the last remaining owner (including self).

REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_entries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_entries() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_entries() TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_org_role(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_org_role(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid, uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not EXECUTE public.rate_limit_hit';
  END IF;
  IF has_function_privilege('authenticated', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not EXECUTE public.rate_limit_hit';
  END IF;
  IF has_function_privilege('anon', 'public.cleanup_rate_limit_entries()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not EXECUTE public.cleanup_rate_limit_entries';
  END IF;
  IF has_function_privilege('authenticated', 'public.cleanup_rate_limit_entries()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not EXECUTE public.cleanup_rate_limit_entries';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must EXECUTE public.rate_limit_hit';
  END IF;
  IF has_function_privilege('anon', 'public.is_org_member(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not EXECUTE public.is_org_member';
  END IF;
  IF has_function_privilege('anon', 'public.get_org_role(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not EXECUTE public.get_org_role';
  END IF;
END $$;

DROP POLICY IF EXISTS "Creators can insert first owner membership" ON public.org_members;
CREATE POLICY "Creators can insert first owner membership"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = org_members.org_id AND o.created_by = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = org_members.org_id
    )
  );

DROP POLICY IF EXISTS "Owners can update org members" ON public.org_members;
CREATE POLICY "Owners can update org members"
  ON public.org_members FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), org_members.org_id) = 'owner')
  WITH CHECK (
    public.get_org_role(auth.uid(), org_members.org_id) = 'owner'
    AND (
      role = 'owner'
      OR (
        SELECT count(*) FROM public.org_members m
        WHERE m.org_id = org_members.org_id
          AND m.role = 'owner'
          AND m.user_id IS DISTINCT FROM org_members.user_id
      ) >= 1
    )
  );
