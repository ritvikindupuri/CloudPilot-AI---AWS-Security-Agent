/**
 * Database-backed per-user rate limiter. Fails closed on DB errors.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  dbError?: boolean;
}

export interface RateLimitClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: string): {
        gte(col: string, val: string): {
          maybeSingle(): Promise<{ data: { id: string; request_count: number } | null; error: { message: string } | null }>;
        };
      };
    };
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): Promise<{ error: { message: string } | null }>;
    };
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  };
}

export async function checkDbRateLimit(
  supabaseAdmin: RateLimitClient,
  key: string,
  maxRequests: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const retryAfterSeconds = windowMinutes * 60;
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

    const { data: rlEntry, error: selectError } = await supabaseAdmin
      .from("rate_limit_entries")
      .select("*")
      .eq("key", key)
      .gte("window_start", windowStart.toISOString())
      .maybeSingle();

    if (selectError) {
      console.error("[rate-limit] select failed", selectError.message);
      return { allowed: false, retryAfterSeconds, dbError: true };
    }

    if (rlEntry && rlEntry.request_count >= maxRequests) {
      return { allowed: false, retryAfterSeconds };
    }

    if (rlEntry) {
      const { error: updateError } = await supabaseAdmin
        .from("rate_limit_entries")
        .update({ request_count: rlEntry.request_count + 1 })
        .eq("id", rlEntry.id);
      if (updateError) {
        console.error("[rate-limit] update failed", updateError.message);
        return { allowed: false, retryAfterSeconds, dbError: true };
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("rate_limit_entries")
        .insert({ key, request_count: 1, window_start: now.toISOString() });
      if (insertError) {
        console.error("[rate-limit] insert failed", insertError.message);
        return { allowed: false, retryAfterSeconds, dbError: true };
      }
    }

    return { allowed: true, retryAfterSeconds };
  } catch (err) {
    console.error("[rate-limit] unexpected failure", err);
    return { allowed: false, retryAfterSeconds, dbError: true };
  }
}
