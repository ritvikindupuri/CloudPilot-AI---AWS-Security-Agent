/**
 * Fail-closed CORS helper.
 * Only echoes Access-Control-Allow-Origin when the request Origin is on the allowlist.
 * Production must set ALLOWED_ORIGINS. Localhost is never mixed in when it is set.
 * When ALLOWED_ORIGINS is empty, origins are allowed only if CLOUDPILOT_DEV is true.
 */

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:5173",
];

const DEFAULT_ALLOW_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "x-guardian-secret",
  "stripe-signature",
].join(", ");

function flagEnabled(value: string | undefined): boolean {
  const flag = (value || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function isDevCors(env: { get(key: string): string | undefined } = Deno.env): boolean {
  return flagEnabled(env.get("CLOUDPILOT_DEV"));
}

export function getAllowedOrigins(env: { get(key: string): string | undefined } = Deno.env): string[] {
  const extra = (env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.length > 0) return extra;
  if (isDevCors(env)) return DEFAULT_DEV_ORIGINS;
  return [];
}

export function isOriginAllowed(origin: string, env: { get(key: string): string | undefined } = Deno.env): boolean {
  if (!origin) return false;
  return getAllowedOrigins(env).includes(origin);
}

export interface CorsOptions {
  allowHeaders?: string;
  allowMethods?: string;
  env?: { get(key: string): string | undefined };
}

export function getCorsHeaders(req: Request, options: CorsOptions = {}): Record<string, string> {
  const env = options.env ?? Deno.env;
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": options.allowHeaders || DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": options.allowMethods || "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };

  if (isOriginAllowed(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}
