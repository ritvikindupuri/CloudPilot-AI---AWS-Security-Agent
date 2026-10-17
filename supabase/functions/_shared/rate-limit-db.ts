/**
 * Database-backed per-user rate limiter. Fails closed on DB errors.
 * Uses atomic UPSERT via rate_limit_hit(key, max, window_seconds).
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  dbError?: boolean;
}

export interface RateLimitClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: Array<{ allowed: boolean; request_count: number; retry_after_seconds: number }> | { allowed: boolean; request_count: number; retry_after_seconds: number } | null; error: { message: string } | null }>;
}

export async function checkDbRateLimit(
  supabaseAdmin: RateLimitClient,
  key: string,
  maxRequests: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const retryAfterSeconds = windowMinutes * 60;
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      p_key: key,
      p_max: maxRequests,
      p_window_seconds: retryAfterSeconds,
    });
    if (error) {
      console.error("[rate-limit] rpc failed", error.message);
      return { allowed: false, retryAfterSeconds, dbError: true };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { allowed: false, retryAfterSeconds, dbError: true };
    }
    return {
      allowed: Boolean(row.allowed),
      retryAfterSeconds: Number(row.retry_after_seconds) || retryAfterSeconds,
    };
  } catch (err) {
    console.error("[rate-limit] unexpected failure", err);
    return { allowed: false, retryAfterSeconds, dbError: true };
  }
}
