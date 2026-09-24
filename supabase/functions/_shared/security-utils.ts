// SECURITY HARDENING: Shared security utilities for credential sanitization and validation

/**
 * Sanitizes credential objects by redacting sensitive fields before logging.
 * Prevents AWS credentials, tokens, and secrets from appearing in logs.
 */
export function sanitizeForLogging(obj: any): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const sensitiveKeys = [
    "accessKeyId",
    "secretAccessKey",
    "sessionToken",
    "password",
    "secret",
    "apiKey",
    "token",
    "credential",
    "authorization",
    "privateKey",
  ];

  const sanitized: any = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    const isSensitive = sensitiveKeys.some((sk) => keyLower.includes(sk.toLowerCase()));

    if (isSensitive && typeof value === "string" && value.length > 0) {
      // Redact but show prefix and length for debugging
      const prefix = value.slice(0, 4);
      sanitized[key] = `${prefix}***[REDACTED ${value.length} chars]`;
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validates that required security headers are present in the request.
 */
export function validateSecurityHeaders(req: Request): { valid: boolean; error?: string } {
  const contentType = req.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return { valid: false, error: "Invalid Content-Type. Expected application/json" };
  }

  return { valid: true };
}

/**
 * Rate limiting with in-memory token bucket.
 * Returns true if request should be allowed, false if rate limited.
 */
const rateLimitBuckets = new Map<string, { tokens: number; lastRefill: number }>();

export function checkRateLimit(
  identifier: string,
  maxTokens: number = 10,
  refillRate: number = 1,
  refillIntervalMs: number = 1000
): boolean {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(identifier);

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    rateLimitBuckets.set(identifier, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = Math.floor(elapsed / refillIntervalMs) * refillRate;
  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  // Check if we have tokens available
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

/**
 * Validates AWS credential format without making AWS API calls.
 */
export function validateAwsCredentialFormat(credentials: any): { valid: boolean; error?: string } {
  if (!credentials || typeof credentials !== "object") {
    return { valid: false, error: "Credentials must be an object" };
  }

  const AWS_REGION_REGEX = /^[a-z]{2}(-[a-z]+-\d+)?$/;
  const ACCESS_KEY_REGEX = /^[A-Z0-9]{16,128}$/;

  if (credentials.method === "access_key") {
    if (!credentials.accessKeyId || typeof credentials.accessKeyId !== "string") {
      return { valid: false, error: "accessKeyId is required and must be a string" };
    }
    if (!ACCESS_KEY_REGEX.test(credentials.accessKeyId)) {
      return { valid: false, error: "Invalid accessKeyId format" };
    }
    if (!credentials.secretAccessKey || typeof credentials.secretAccessKey !== "string") {
      return { valid: false, error: "secretAccessKey is required and must be a string" };
    }
  } else if (credentials.method === "assume_role") {
    const ROLE_ARN_REGEX = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;
    if (!credentials.roleArn || !ROLE_ARN_REGEX.test(credentials.roleArn)) {
      return { valid: false, error: "Invalid roleArn format" };
    }
  } else {
    return { valid: false, error: `Unsupported credentials method: ${credentials.method}` };
  }

  if (credentials.region && !AWS_REGION_REGEX.test(credentials.region)) {
    return { valid: false, error: "Invalid AWS region format" };
  }

  return { valid: true };
}
