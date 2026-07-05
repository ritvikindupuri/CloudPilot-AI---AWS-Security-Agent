import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guardian-secret",
};

/**
 * Webhook Notification Service
 * 
 * Sends Guardian alerts and auto-fix notifications to external channels:
 * - Slack (via Incoming Webhook URL)
 * - PagerDuty (via Events API v2)
 * - Generic webhook (POST JSON)
 * 
 * Webhook URLs are stored in notification_webhooks table per user/org.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTOMATION_SECRET = Deno.env.get("GUARDIAN_AUTOMATION_WEBHOOK_SECRET") || "";

interface WebhookPayload {
  type: "guardian_alert" | "auto_fix" | "drift_detected" | "cost_anomaly" | "scan_complete";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  timestamp: string;
  accountId?: string;
  region?: string;
}

async function sendSlackWebhook(url: string, payload: WebhookPayload): Promise<boolean> {
  const colorMap: Record<string, string> = {
    critical: "#dc2626",
    high: "#ea580c",
    medium: "#d97706",
    low: "#2563eb",
    info: "#6b7280",
  };

  const slackBody = {
    attachments: [{
      color: colorMap[payload.severity] || "#6b7280",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🛡️ CloudPilot: ${payload.title}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Type:*\n${payload.type.replace(/_/g, " ").toUpperCase()}` },
            { type: "mrkdwn", text: `*Severity:*\n${payload.severity.toUpperCase()}` },
            ...(payload.accountId ? [{ type: "mrkdwn", text: `*Account:*\n${payload.accountId}` }] : []),
            ...(payload.region ? [{ type: "mrkdwn", text: `*Region:*\n${payload.region}` }] : []),
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: payload.summary },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `CloudPilot AI · ${payload.timestamp}` }],
        },
      ],
    }],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackBody),
  });
  return resp.ok;
}

async function sendPagerDutyEvent(routingKey: string, payload: WebhookPayload): Promise<boolean> {
  const severityMap: Record<string, string> = {
    critical: "critical",
    high: "error",
    medium: "warning",
    low: "info",
    info: "info",
  };

  const pdBody = {
    routing_key: routingKey,
    event_action: "trigger",
    payload: {
      summary: `[CloudPilot] ${payload.title}: ${payload.summary}`,
      severity: severityMap[payload.severity] || "info",
      source: "cloudpilot-ai",
      component: payload.type,
      group: payload.accountId || "unknown",
      custom_details: {
        ...payload.details,
        region: payload.region,
        timestamp: payload.timestamp,
      },
    },
  };

  const resp = await fetch("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pdBody),
  });
  return resp.ok;
}

async function sendGenericWebhook(url: string, payload: WebhookPayload): Promise<boolean> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "cloudpilot-ai",
      ...payload,
    }),
  });
  return resp.ok;
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json();

    // Auth: either user token or guardian secret
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      userId = user?.id || null;
    }
    const guardianSecret = req.headers.get("x-guardian-secret");
    if (!userId && guardianSecret === AUTOMATION_SECRET) {
      userId = body.userId;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action } = body;

    // Register a webhook
    if (action === "register") {
      const { channel_type, webhook_url, label, events } = body;
      if (!channel_type || !webhook_url) {
        return new Response(JSON.stringify({ error: "channel_type and webhook_url are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabaseAdmin
        .from("notification_webhooks")
        .insert({
          user_id: userId,
          channel_type, // "slack" | "pagerduty" | "generic"
          webhook_url,
          label: label || channel_type,
          subscribed_events: events || ["guardian_alert", "auto_fix", "drift_detected", "cost_anomaly"],
          is_active: true,
        });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send notification to all active webhooks for a user
    if (action === "notify") {
      const payload: WebhookPayload = {
        type: body.type || "guardian_alert",
        severity: body.severity || "medium",
        title: body.title || "CloudPilot Alert",
        summary: body.summary || "",
        details: body.details || {},
        timestamp: new Date().toISOString(),
        accountId: body.accountId,
        region: body.region,
      };

      const { data: webhooks } = await supabaseAdmin
        .from("notification_webhooks")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (!webhooks || webhooks.length === 0) {
        return new Response(JSON.stringify({ sent: 0, note: "No active webhooks configured" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: Array<{ channel: string; success: boolean }> = [];

      for (const wh of webhooks) {
        // Check if webhook is subscribed to this event type
        const subscribedEvents = Array.isArray(wh.subscribed_events) ? wh.subscribed_events : [];
        if (subscribedEvents.length > 0 && !subscribedEvents.includes(payload.type)) continue;

        let success = false;
        try {
          if (wh.channel_type === "slack") {
            success = await sendSlackWebhook(wh.webhook_url, payload);
          } else if (wh.channel_type === "pagerduty") {
            success = await sendPagerDutyEvent(wh.webhook_url, payload);
          } else {
            success = await sendGenericWebhook(wh.webhook_url, payload);
          }
        } catch (e) {
          console.error(`Webhook delivery failed for ${wh.id}:`, e);
        }
        results.push({ channel: wh.label || wh.channel_type, success });
      }

      return new Response(JSON.stringify({
        sent: results.filter(r => r.success).length,
        total: results.length,
        results,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List webhooks
    if (action === "list") {
      const { data } = await supabaseAdmin
        .from("notification_webhooks")
        .select("id, channel_type, label, subscribed_events, is_active, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      return new Response(JSON.stringify({ webhooks: data || [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete webhook
    if (action === "delete") {
      const { webhookId } = body;
      await supabaseAdmin
        .from("notification_webhooks")
        .delete()
        .eq("id", webhookId)
        .eq("user_id", userId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) {
  serve(handler);
}
