import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getVersionMeta } from "../_shared/version.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";

// SECURITY HARDENING: Strict CORS origin validation with allowlist
const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:5173",
  ...(Deno.env.get("ALLOWED_ORIGINS") || "").split(",").filter(Boolean),
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) 
    ? origin 
    : (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080");
  
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

async function dispatch(calls: any[], functionName: string, rest: Record<string, any>, serviceKey: string): Promise<any[]> {
  if (calls.length === 0) return [];
  
  // Always use service role key for internal function-to-function calls
  // to avoid conflicts when the caller sends a publishable key
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({ toolCalls: calls, ...rest }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[Router] ${functionName} error:`, resp.status, errText);
    return calls.map((tc: any) => ({
      toolCallId: tc.id,
      content: JSON.stringify({
        error: `Tool dispatch error from ${functionName} (${resp.status})`,
        message: errText || "No additional error details were returned.",
        errorClass: "PLATFORM_DISPATCH",
        service: functionName,
      }),
    }));
  }
  const data = await resp.json();
  return data.results || [];
}

export const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  // Health check endpoint with version info (no auth required)
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    return new Response(
      JSON.stringify({
        status: "healthy",
        service: "aws-agent-tools",
        ...getVersionMeta(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // SECURITY: Only aws-agent can call the POST endpoint (verified via service role key)
  // This prevents direct calls from the public anon key from forging userId or userHasConfirmedMutation
  const authError = requireServiceRole(req, SERVICE_ROLE_KEY, corsHeaders, "aws-agent-tools");
  if (authError) {
    return authError;
  }

  // After requireServiceRole passes, SERVICE_ROLE_KEY is guaranteed to be non-empty
  const serviceKey = SERVICE_ROLE_KEY as string;

  try {
    const body = await req.json();
    const { toolCalls, ...rest } = body;

    const scannerCalls = toolCalls.filter((tc: any) => SCANNER_TOOLS.has(tc.function.name));
    const opsCalls = toolCalls.filter((tc: any) => OPS_TOOLS.has(tc.function.name));
    
    // Handle unknown tools - return explicit error
    const knownToolNames = new Set([...SCANNER_TOOLS, ...OPS_TOOLS]);
    const unknownCalls = toolCalls.filter((tc: any) => !knownToolNames.has(tc.function.name));
    const unknownResults = unknownCalls.map((tc: any) => ({
      toolCallId: tc.id,
      content: JSON.stringify({
        error: `Unknown tool: ${tc.function.name}`,
        errorClass: "PLATFORM_DISPATCH",
        message: `Tool ${tc.function.name} is not registered in aws-agent-tools. Available tools: ${Array.from(knownToolNames).join(", ")}`,
      }),
    }));

    const [scannerResults, opsResults] = await Promise.all([
      dispatch(scannerCalls, "aws-agent-scanner", rest, serviceKey),
      dispatch(opsCalls, "aws-agent-ops", rest, serviceKey),
    ]);

    const results = [...scannerResults, ...opsResults, ...unknownResults];

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
