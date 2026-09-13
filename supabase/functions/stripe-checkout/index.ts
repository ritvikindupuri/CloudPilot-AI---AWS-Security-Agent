// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLANS: Record<string, { priceAmount: number; name: string }> = {
  pro: { priceAmount: 4900, name: "Pro" },
  enterprise: { priceAmount: 19900, name: "Enterprise" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub;
    const userEmail = claimsData.claims.email;

    const body = await req.json();
    const { action } = body;

    if (action === "create_checkout") {
      const { plan_id, org_id, success_url, cancel_url } = body;

      if (!plan_id || !org_id || !success_url || !cancel_url) {
        return new Response(
          JSON.stringify({ error: "plan_id, org_id, success_url, cancel_url are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const plan = PLANS[plan_id];
      if (!plan) {
        return new Response(
          JSON.stringify({ error: `Invalid plan_id: ${plan_id}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check caller is an org owner
      const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: membership } = await adminClient
        .from("org_members")
        .select("role")
        .eq("org_id", org_id)
        .eq("user_id", userId)
        .single();

      if (!membership || membership.role !== "owner") {
        return new Response(
          JSON.stringify({ error: "Only org owners can manage billing" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check for existing Stripe customer
      const { data: existingSub } = await adminClient
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("org_id", org_id)
        .maybeSingle();

      let customerId: string;

      if (existingSub?.stripe_customer_id) {
        customerId = existingSub.stripe_customer_id;
      } else {
        // Create new Stripe customer
        const customer = await stripe.customers.create({
          email: userEmail,
          metadata: { org_id, user_id: userId },
        });
        customerId = customer.id;
      }

      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `CloudPilot ${plan.name}`,
                description: `${plan.name} plan - per seat per month`,
              },
              unit_amount: plan.priceAmount,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url,
        metadata: { org_id, user_id: userId, plan_id },
        subscription_data: {
          metadata: { org_id, user_id: userId, plan_id },
        },
      });

      return new Response(
        JSON.stringify({ url: session.url, session_id: session.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "create_portal") {
      const { org_id, return_url } = body;

      if (!org_id || !return_url) {
        return new Response(
          JSON.stringify({ error: "org_id and return_url are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("org_id", org_id)
        .maybeSingle();

      if (!sub?.stripe_customer_id) {
        return new Response(
          JSON.stringify({ error: "No subscription found for this organization" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url,
      });

      return new Response(
        JSON.stringify({ url: portalSession.url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_subscription") {
      const { org_id } = body;

      if (!org_id) {
        return new Response(
          JSON.stringify({ error: "org_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("*")
        .eq("org_id", org_id)
        .maybeSingle();

      const { data: payments } = await adminClient
        .from("payment_history")
        .select("*")
        .eq("org_id", org_id)
        .order("created_at", { ascending: false })
        .limit(10);

      return new Response(
        JSON.stringify({ subscription: sub, payments: payments || [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
