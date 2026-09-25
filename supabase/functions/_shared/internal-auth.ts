/**
 * Internal Authentication Helper
 * Enforces service-role-only access to prevent userId/confirmation forgery
 */

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify that the request uses the service role key
 * Returns 401 JSON response if not authorized
 * 
 * @param req - The incoming request
 * @param serviceRoleKey - The expected service role key
 * @param corsHeaders - CORS headers to include in response
 * @param serviceName - Name of the service for error messages
 * @returns null if authorized, or a 401 Response to return
 */
export function requireServiceRole(
  req: Request,
  serviceRoleKey: string | undefined,
  corsHeaders: Record<string, string>,
  serviceName: string
): Response | null {
  // Guard against misconfiguration
  if (!serviceRoleKey || serviceRoleKey.trim().length === 0) {
    return new Response(
      JSON.stringify({
        error: "Server misconfigured",
        message: `${serviceName} requires SUPABASE_SERVICE_ROLE_KEY to be configured.`,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("Authorization");
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, "");

  // Constant-time comparison to prevent timing attacks
  if (!bearerToken || !constantTimeCompare(bearerToken, serviceRoleKey)) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: `${serviceName} requires service role authentication.`,
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return null; // Authorized
}
