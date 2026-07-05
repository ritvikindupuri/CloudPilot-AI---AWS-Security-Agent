import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SCANNER_TOOLS = new Set([
  "run_unified_audit", "run_cost_anomaly_scan", "manage_cost_rule",
  "manage_drift_baseline", "run_drift_detection", "execute_aws_api",
]);

const OPS_TOOLS = new Set([
  "manage_runbook_execution", "manage_event_response_policy",
  "replay_cloudtrail_events", "run_org_query", "manage_org_operation",
  "manage_security_group_rule", "manage_iam_access",
  "run_attack_simulation", "run_evasion_test",
]);

async function dispatch(calls: any[], functionName: string, rest: Record<string, any>, authHeader: string | null): Promise<any[]> {
  if (calls.length === 0) return [];
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader || `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ toolCalls: calls, ...rest }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[Router] ${functionName} error:`, resp.status, errText);
    return calls.map((tc: any) => ({
      toolCallId: tc.id,
      content: JSON.stringify({
        error: `Tool dispatch error from ${functionName} (${resp.status}). ${errText || "No additional error details were returned."}`,
      }),
    }));
  }
  const data = await resp.json();
  return data.results || [];
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { toolCalls, ...rest } = body;
    const authHeader = req.headers.get("Authorization");

    const scannerCalls = toolCalls.filter((tc: any) => SCANNER_TOOLS.has(tc.function.name));
    const opsCalls = toolCalls.filter((tc: any) => OPS_TOOLS.has(tc.function.name));

    const [scannerResults, opsResults] = await Promise.all([
      dispatch(scannerCalls, "aws-agent-scanner", rest, authHeader),
      dispatch(opsCalls, "aws-agent-ops", rest, authHeader),
    ]);

    const results = [...scannerResults, ...opsResults];

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[CloudPilot Router] Fatal error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

if (import.meta.main) {
  serve(handler);
}
