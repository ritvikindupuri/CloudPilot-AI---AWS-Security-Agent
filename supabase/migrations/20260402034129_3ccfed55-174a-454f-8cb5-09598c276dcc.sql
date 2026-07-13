
-- Create custom app_role type if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'member', 'viewer');
  END IF;
END $$;

-- Create organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create org_members table
CREATE TABLE IF NOT EXISTS public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- Create user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
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
AS $$
DECLARE
  _role public.app_role;
BEGIN
  SELECT role INTO _role FROM public.org_members
  WHERE org_id = _org_id AND user_id = _user_id;
  RETURN _role;
END;
$$;

-- Subscription tracking table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  plan_name TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  seats INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their org's subscription
CREATE POLICY "Org members can view subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), org_id));

-- Only owners can manage subscriptions
CREATE POLICY "Org owners can manage subscriptions"
  ON public.subscriptions FOR ALL TO authenticated
  USING (get_org_role(auth.uid(), org_id) = 'owner')
  WITH CHECK (get_org_role(auth.uid(), org_id) = 'owner');

-- Service role full access for webhooks
CREATE POLICY "Service role full access on subscriptions"
  ON public.subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Payment history table
CREATE TABLE public.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'succeeded',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view payment history"
  ON public.payment_history FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), org_id));

CREATE POLICY "Service role full access on payment_history"
  ON public.payment_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);
