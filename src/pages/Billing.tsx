import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CreditCard, Check, Shield, Zap, Info, Loader2, ExternalLink, Receipt, AlertCircle, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Subscription {
  id: string;
  plan_name: string;
  status: string;
  seats: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface Payment {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  description: string;
  created_at: string;
}

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    icon: Gift,
    features: [
      "5 API Executions / day",
      "Single AWS Account",
      "VPC Routing (Standard)",
      "Basic Security Scans",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    icon: Shield,
    features: [
      "Unlimited API Executions",
      "Advanced Threat Detection",
      "Real-time Alerts (Slack/PagerDuty)",
      "VPC Routing (High-throughput)",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    icon: Zap,
    highlighted: true,
    features: [
      "Everything in Pro",
      "Cross-Account Role Auditing",
      "SSO & SAML Integration",
      "Immutable Audit Trails (WORM)",
      "Custom Event Policies",
      "24/7 Priority Support",
    ],
  },
];

const Billing = () => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);

  const fetchBillingData = useCallback(async () => {
    if (!user) return;

    try {
      // Get user's org
      const { data: membership } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (!membership) return;
      setOrgId(membership.org_id);

      // Get subscription data from edge function
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "get_subscription", org_id: membership.org_id }),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        setSubscription(data.subscription);
        setPayments(data.payments || []);
      }
    } catch (err) {
      console.error("Failed to fetch billing:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchBillingData();
  }, [fetchBillingData]);

  const handleCheckout = async (planId: string) => {
    if (!user || !orgId) {
      toast.error("You must be logged in and belong to an organization.");
      return;
    }

    setCheckoutLoading(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "create_checkout",
            plan_id: planId,
            org_id: orgId,
            success_url: window.location.origin + "/billing",
            cancel_url: window.location.origin + "/billing",
          }),
        }
      );

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);

      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start checkout";
      toast.error(message);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    if (!orgId) return;

    setPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "create_portal",
            org_id: orgId,
            return_url: window.location.origin + "/billing",
          }),
        }
      );

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);

      window.location.href = data.url;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to open billing portal";
      toast.error(message);
    } finally {
      setPortalLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (cents: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      past_due: "bg-amber-500/15 text-amber-400 border-amber-500/25",
      canceled: "bg-destructive/15 text-destructive border-destructive/25",
      trialing: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    };
    return (
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${colors[status] || colors.active}`}>
        {status.replace("_", " ").toUpperCase()}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link to="/app">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Chat
              </Link>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold tracking-tight">Billing & Subscriptions</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
        {/* Current subscription banner */}
        {subscription && (
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold capitalize">{subscription.plan_name} Plan</h3>
                  {statusBadge(subscription.status)}
                </div>
                {subscription.current_period_end && (
                  <p className="text-sm text-muted-foreground">
                    {subscription.cancel_at_period_end
                      ? `Cancels on ${formatDate(subscription.current_period_end)}`
                      : `Renews on ${formatDate(subscription.current_period_end)}`}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManageSubscription}
                disabled={portalLoading}
              >
                {portalLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-2" />
                )}
                Manage Subscription
              </Button>
            </div>
          </div>
        )}

        {/* Plans */}
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Plans that scale with your security team</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Get complete visibility into your cloud environments. Pay per seat, cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {PLANS.map((plan) => {
            const isCurrentPlan = subscription?.plan_name === plan.id && subscription?.status === "active";
            const Icon = plan.icon;

            return (
              <div
                key={plan.id}
                className={`bg-card border rounded-xl p-8 relative overflow-hidden flex flex-col ${
                  plan.highlighted
                    ? "border-2 border-primary/50 shadow-lg shadow-primary/5"
                    : "border-border"
                }`}
              >
                {isCurrentPlan && (
                  <div className="absolute top-0 right-0 bg-primary/10 text-primary px-3 py-1 rounded-bl-lg text-xs font-semibold tracking-wider">
                    CURRENT PLAN
                  </div>
                )}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Icon className="w-6 h-6" />
                    <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{plan.price === 0 ? "Free" : `$${plan.price}`}</span>
                    {plan.price > 0 && <span className="text-muted-foreground text-sm">/ seat / mo</span>}
                  </div>
                </div>

                <div className="mt-8 space-y-3 flex-1">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-3">
                      <Check className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                </div>

                {isCurrentPlan ? (
                  plan.id === "free" ? (
                    <Button className="w-full mt-8" variant="outline" disabled>
                      Current Plan
                    </Button>
                  ) : (
                    <Button className="w-full mt-8" variant="outline" onClick={handleManageSubscription} disabled={portalLoading}>
                      {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Manage Subscription"}
                    </Button>
                  )
                ) : plan.id === "free" ? (
                  <Button className="w-full mt-8" variant="outline" disabled>
                    {subscription?.plan_name && subscription.plan_name !== "free" ? "Included" : "Current Plan"}
                  </Button>
                ) : (
                  <Button
                    className={`w-full mt-8 ${plan.highlighted ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""}`}
                    variant={plan.highlighted ? "default" : "outline"}
                    onClick={() => handleCheckout(plan.id)}
                    disabled={!!checkoutLoading || loading}
                  >
                    {checkoutLoading === plan.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : subscription && subscription.plan_name !== "free" ? (
                      `Switch to ${plan.name}`
                    ) : (
                      `Upgrade to ${plan.name}`
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Payment History */}
        {payments.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Payment History</h3>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Description</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(payment.created_at)}</td>
                      <td className="px-4 py-3">{payment.description}</td>
                      <td className="px-4 py-3">
                        {payment.status === "succeeded" ? (
                          <span className="text-emerald-400 text-xs font-medium">Paid</span>
                        ) : (
                          <span className="flex items-center gap-1 text-destructive text-xs font-medium">
                            <AlertCircle className="w-3 h-3" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(payment.amount_cents, payment.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-muted/50 border border-border rounded-lg p-4 flex items-start gap-3 text-sm text-muted-foreground">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <p>
            Payments are processed securely via Stripe. Need custom invoicing or annual contracts? Contact our sales team.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Billing;
