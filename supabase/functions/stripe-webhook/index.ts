// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

// SECURITY: Enforce ALLOWED_ORIGIN in production
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN");
if (!ALLOWED_ORIGIN && Deno.env.get("ENVIRONMENT") === "production") {
  throw new Error("ALLOWED_ORIGIN must be set in production");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN || "http://localhost:8080",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  // Security headers
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let event: Stripe.Event;
    const body = await req.text();

    if (webhookSecret) {
      const sig = req.headers.get("stripe-signature");
      if (!sig) {
        return new Response(
          JSON.stringify({ error: "Missing stripe-signature header" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
      } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // No webhook secret configured — parse event directly (dev mode)
      event = JSON.parse(body);
    }

    console.log(`Processing Stripe event: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.org_id;
        const userId = session.metadata?.user_id;
        const planId = session.metadata?.plan_id || "pro";

        if (!orgId || !userId) {
          console.error("Missing org_id or user_id in session metadata");
          break;
        }

        // Upsert subscription record
        const { error: upsertError } = await adminClient
          .from("subscriptions")
          .upsert({
            user_id: userId,
            org_id: orgId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            plan_name: planId,
            status: "active",
            seats: 1,
          }, { onConflict: "stripe_subscription_id" });

        if (upsertError) {
          console.error("Failed to upsert subscription:", upsertError);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata?.org_id;

        if (!orgId) {
          console.error("Missing org_id in subscription metadata");
          break;
        }

        const { error } = await adminClient
          .from("subscriptions")
          .update({
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (error) console.error("Failed to update subscription:", error);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        const { error } = await adminClient
          .from("subscriptions")
          .update({
            status: "canceled",
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (error) console.error("Failed to cancel subscription:", error);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        // Look up org from subscription
        const { data: sub } = await adminClient
          .from("subscriptions")
          .select("org_id")
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle();

        if (sub?.org_id) {
          await adminClient.from("payment_history").insert({
            org_id: sub.org_id,
            stripe_invoice_id: invoice.id,
            stripe_payment_intent_id: invoice.payment_intent as string,
            amount_cents: invoice.amount_paid,
            currency: invoice.currency,
            status: "succeeded",
            description: `${invoice.lines?.data?.[0]?.description || "Subscription payment"}`,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        const { data: sub } = await adminClient
          .from("subscriptions")
          .select("org_id")
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle();

        if (sub?.org_id) {
          await adminClient.from("payment_history").insert({
            org_id: sub.org_id,
            stripe_invoice_id: invoice.id,
            amount_cents: invoice.amount_due,
            currency: invoice.currency,
            status: "failed",
            description: "Payment failed",
          });

          // Update subscription status
          await adminClient
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", subscriptionId);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
