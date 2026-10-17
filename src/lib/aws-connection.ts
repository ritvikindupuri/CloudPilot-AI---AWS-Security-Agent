/** Client-side AWS connection metadata. Never persist AWS secrets. */

const LEGACY_STORAGE_KEY = "cloudpilot-aws-credentials";
const STORAGE_KEY = "cloudpilot-aws-connection";

const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1", "eu-north-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-south-1",
  "sa-east-1", "ca-central-1", "me-south-1", "af-south-1",
] as const;

export interface AwsConnection {
  method: "access_key" | "assume_role";
  region: string;
  credentialId?: string;
  identity?: { account: string; arn: string };
  permissions?: Record<string, boolean>;
  displayKeyPrefix?: string;
  /** Shown once after generation so the customer can put it in CloudFormation. Not persisted. */
  externalId?: string;
  connected?: boolean;
  expiresAt?: string;
}

function publicMethod(value: unknown): "access_key" | "assume_role" {
  return value === "access_key" ? "access_key" : "assume_role";
}

function publicRegion(value: unknown): string {
  const match = AWS_REGIONS.find((region) => region === value);
  return match ?? "us-east-1";
}

function publicCredentialId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

/** Allowlisted metadata only. Secrets, ExternalId, and key prefixes are dropped. */
export function toPublicAwsConnection(value: unknown): AwsConnection | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const connection: AwsConnection = {
    method: publicMethod(src.method),
    region: publicRegion(src.region),
    connected: src.connected === true,
  };
  const credentialId = publicCredentialId(src.credentialId);
  if (credentialId) connection.credentialId = credentialId;
  return connection;
}

/** @deprecated Use toPublicAwsConnection. Kept for tests of the denylist path. */
export function stripAwsSecrets<T extends Record<string, unknown>>(value: T | null | undefined): T | null {
  return toPublicAwsConnection(value) as T | null;
}

export function persistPublicAwsConnection(value: unknown): AwsConnection | null {
  const publicConnection = toPublicAwsConnection(value);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  if (!publicConnection) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(publicConnection));
  return publicConnection;
}

export function loadStoredAwsConnection(): AwsConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw || raw === "undefined") return null;
    const parsed = JSON.parse(raw);
    const publicConnection = toPublicAwsConnection(parsed);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (!publicConnection) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(publicConnection));
    return publicConnection;
  } catch {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearStoredAwsConnection(): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
}
