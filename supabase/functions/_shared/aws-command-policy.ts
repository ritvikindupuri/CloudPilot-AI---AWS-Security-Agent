/**
 * Server-side AWS command policy: read-only by default, block IAM privilege
 * escalation outright, and require a stored UI approval for remaining writes.
 */

export type RiskLevel = "BLOCKED" | "REQUIRES_APPROVAL" | "ALLOWED";

export interface CommandDecision {
  allowed: boolean;
  requiresApproval: boolean;
  riskLevel: RiskLevel;
  reason?: string;
  normalizedService: string;
  normalizedOperation: string;
  normalizedCommand: string;
}

const READ_ONLY_RE = /^(Get|List|Describe|Head)/i;

export const DESTRUCTIVE_OPERATIONS = new Set([
  "closeaccount",
  "leaveorganization",
  "deleteorganization",
  "createaccount",
  "inviteaccounttoorganization",
  "terminateinstances",
  "deletebucket",
  "deletedbinstance",
  "deletetable",
  "deletecluster",
  "deletefunction",
  "deletekey",
  "schedulekeydeletion",
  "deletesecret",
]);

/** IAM / identity privilege-escalation operations — blocked, not approvable. */
export const PRIVILEGE_ESCALATION_OPS: Record<string, Set<string>> = {
  IAM: new Set([
    "createuser",
    "createloginprofile",
    "updateloginprofile",
    "createaccesskey",
    "putuserpolicy",
    "attachuserpolicy",
    "putgrouppolicy",
    "attachgrouppolicy",
    "putrolepolicy",
    "attachrolepolicy",
    "createpolicy",
    "createpolicyversion",
    "setdefaultpolicyversion",
    "addusertogroup",
    "updateassumerolepolicy",
    "createservicelinkedrole",
    "passrole",
    "putuserpermissionsboundary",
    "putrolepermissionsboundary",
    "attachrolepolicy",
    "deleterolepermissionsboundary",
    "deleteuserpermissionsboundary",
  ]),
  STS: new Set([
    "assumerole",
    "assumerolewithsaml",
    "assumerolewithwebidentity",
    "getfederationtoken",
    "getsessiontoken",
  ]),
  ORGANIZATIONS: new Set([
    "createpolicy",
    "attachpolicy",
    "updatepolicy",
    "enablepolicytype",
  ]),
  LAMBDA: new Set([
    "createfunction",
    "updatefunctioncode",
    "addpermission",
  ]),
};

const SENSITIVE_CONFIG_KEYS = new Set([
  "endpoint",
  "endpointprovider",
  "credentialsprovider",
  "credentialdefaultprovider",
  "customuseragent",
  "requesthandler",
  "logger",
  "systemclockoffset",
  "retrystrategy",
  "defaultsMode",
  "defaultsmode",
  "tls",
  "tlsnegotiator",
  "disablehostprefix",
  "useaccelerateendpoint",
  "usefipsendpoint",
  "usedualstackendpoint",
  "forcepathstyle",
  "bucketendpoint",
  "signer",
  "base64decoder",
  "utf8decoder",
]);

export function stripCommandSuffix(commandName: string): string {
  return String(commandName || "").replace(/Command$/i, "");
}

export function normalizeOperation(operation: string): string {
  return stripCommandSuffix(operation).trim();
}

export function isReadOnlyOperation(operation: string): boolean {
  const op = normalizeOperation(operation);
  return READ_ONLY_RE.test(op);
}

export function isPrivilegeEscalation(service: string, operation: string): boolean {
  const svc = String(service || "").toUpperCase();
  const op = normalizeOperation(operation).toLowerCase();
  const blocked = PRIVILEGE_ESCALATION_OPS[svc];
  return !!(blocked && blocked.has(op));
}

export function classifyAwsOperation(service: string, operation: string): CommandDecision {
  const normalizedService = String(service || "").trim();
  const normalizedOperation = normalizeOperation(operation);
  const normalizedCommand = /Command$/i.test(String(operation || ""))
    ? String(operation)
    : `${normalizedOperation.charAt(0).toUpperCase()}${normalizedOperation.slice(1)}Command`;
  const opLower = normalizedOperation.toLowerCase();

  if (!normalizedService || !normalizedOperation) {
    return {
      allowed: false,
      requiresApproval: false,
      riskLevel: "BLOCKED",
      reason: "service and commandName are required",
      normalizedService,
      normalizedOperation,
      normalizedCommand,
    };
  }

  if (DESTRUCTIVE_OPERATIONS.has(opLower)) {
    return {
      allowed: false,
      requiresApproval: false,
      riskLevel: "BLOCKED",
      reason: `Operation '${normalizedOperation}' is permanently blocked because it can cause irreversible account damage.`,
      normalizedService,
      normalizedOperation,
      normalizedCommand,
    };
  }

  if (isPrivilegeEscalation(normalizedService, normalizedOperation)) {
    return {
      allowed: false,
      requiresApproval: false,
      riskLevel: "BLOCKED",
      reason: `Operation '${normalizedService}.${normalizedOperation}' is blocked because it can escalate IAM privileges.`,
      normalizedService,
      normalizedOperation,
      normalizedCommand,
    };
  }

  if (isReadOnlyOperation(normalizedOperation)) {
    return {
      allowed: true,
      requiresApproval: false,
      riskLevel: "ALLOWED",
      normalizedService,
      normalizedOperation,
      normalizedCommand,
    };
  }

  return {
    allowed: false,
    requiresApproval: true,
    riskLevel: "REQUIRES_APPROVAL",
    reason: `Mutating operation '${normalizedService}.${normalizedOperation}' requires an explicit UI approval before it can run.`,
    normalizedService,
    normalizedOperation,
    normalizedCommand,
  };
}

/** Keep only region + static credentials. Strips endpoint and other SSRF/config overrides. */
export function sanitizeAwsClientConfig(config: unknown): {
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
} {
  if (!config || typeof config !== "object") return {};
  const src = config as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof src.region === "string" && /^[a-z]{2}(-[a-z]+-\d+)?$/.test(src.region)) {
    out.region = src.region;
  }

  const creds = src.credentials;
  if (creds && typeof creds === "object") {
    const c = creds as Record<string, unknown>;
    if (typeof c.accessKeyId === "string" && typeof c.secretAccessKey === "string") {
      out.credentials = {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        ...(typeof c.sessionToken === "string" && c.sessionToken ? { sessionToken: c.sessionToken } : {}),
      };
    }
  }

  for (const key of Object.keys(src)) {
    if (SENSITIVE_CONFIG_KEYS.has(key.toLowerCase()) || SENSITIVE_CONFIG_KEYS.has(key)) {
      continue;
    }
  }

  return out as {
    region?: string;
    credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  };
}

export async function hashActionPayload(parts: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(stableStringify(parts));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
