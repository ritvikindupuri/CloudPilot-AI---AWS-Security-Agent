/** Client-side AWS connection metadata. Never persist AWS secrets. */

const SECRET_KEYS = new Set([
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
  "session",
  "geminiApiKey",
]);

export interface AwsConnection {
  method: "access_key" | "assume_role";
  region: string;
  credentialId?: string;
  identity?: { account: string; arn: string };
  permissions?: Record<string, boolean>;
  displayKeyPrefix?: string;
  /** Shown once after generation so the customer can put it in CloudFormation. */
  externalId?: string;
  connected?: boolean;
}

export function stripAwsSecrets<T extends Record<string, unknown>>(value: T | null | undefined): T | null {
  if (!value || typeof value !== "object") return null;
  const out: Record<string, unknown> = Array.isArray(value) ? [] : {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = stripAwsSecrets(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out as T;
}

export function loadStoredAwsConnection(): AwsConnection | null {
  try {
    const raw = localStorage.getItem("cloudpilot-aws-credentials");
    if (!raw || raw === "undefined") return null;
    const parsed = JSON.parse(raw);
    const cleaned = stripAwsSecrets(parsed);
    if (!cleaned) return null;
    if (JSON.stringify(cleaned) !== raw) {
      localStorage.setItem("cloudpilot-aws-credentials", JSON.stringify(cleaned));
    }
    return cleaned as unknown as AwsConnection;
  } catch {
    localStorage.removeItem("cloudpilot-aws-credentials");
    return null;
  }
}
