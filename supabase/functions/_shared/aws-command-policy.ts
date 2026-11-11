/**
 * Server-side AWS command policy: read-only by default, block IAM privilege
 * escalation and defense evasion outright, and require a stored UI approval
 * for remaining writes and secret-returning reads.
 */

export type RiskLevel = "BLOCKED" | "REQUIRES_APPROVAL" | "ALLOWED";
export type PlatformPurpose = "audit" | "notify" | "autofix";

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

export const PLATFORM_AUDIT_LOG_GROUP = "/cloudpilot/agent-audit";
export const PLATFORM_WORM_BUCKET_PREFIX = "cloudpilot-audit-worm-";
export const PLATFORM_SNS_ALERT_TOPIC = "CloudPilot-SecurityAlerts";
export const PLATFORM_SNS_TOPIC_PREFIX = "cloudpilot-alerts-";

export const DESTRUCTIVE_OPERATIONS = new Set([
  "closeaccount",
  "leaveorganization",
  "deleteorganization",
  "createaccount",
  "inviteaccounttoorganization",
  "terminateinstances",
  "deletebucket",
  "deletedbinstance",
  "deletedbcluster",
  "deletetable",
  "deletecluster",
  "deletefunction",
  "deletekey",
  "schedulekeydeletion",
  "deletesecret",
  "deleteloggroup",
  "deleteflowlogs",
]);

/** Defense-evasion APIs — blocked even if they match a generic write path. */
export const DEFENSE_EVASION_OPS: Record<string, Set<string>> = {
  CLOUDTRAIL: new Set([
    "stoplogging",
    "deletetrail",
    "puteventselectors",
    "updatetrail",
  ]),
  GUARDDUTY: new Set([
    "deletedetector",
    "disassociatefrommasteraccount",
    "disassociatefromadministratoraccount",
  ]),
  SECURITYHUB: new Set([
    "disablesecurityhub",
  ]),
  CONFIG: new Set([
    "stopconfigurationrecorder",
    "deleteconfigurationrecorder",
  ]),
  CONFIGSERVICE: new Set([
    "stopconfigurationrecorder",
    "deleteconfigurationrecorder",
  ]),
  EC2: new Set([
    "deleteflowlogs",
  ]),
  LOGS: new Set([
    "deleteloggroup",
  ]),
  CLOUDWATCHLOGS: new Set([
    "deleteloggroup",
  ]),
  RDS: new Set([
    "deletedbcluster",
  ]),
};

/** IAM / identity privilege-escalation operations — blocked, not approvable. */
export const PRIVILEGE_ESCALATION_OPS: Record<string, Set<string>> = {
  IAM: new Set([
    "createuser",
    "createloginprofile",
    "updateloginprofile",
    "createaccesskey",
    "updateaccesskey",
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
    "deleterolepermissionsboundary",
    "deleteuserpermissionsboundary",
    "createrole",
    "updaterole",
    "tagrole",
    "taguser",
    "addroletoinstanceprofile",
    "createinstanceprofile",
    "uploadsshpublickey",
    "createservicespecificcredential",
    "resetservicespecificcredential",
    "uploadsigningcertificate",
    "createvirtualmfadevice",
    "enablemfadevice",
    "deactivatemfadevice",
    "deletevirtualmfadevice",
    "createsamlprovider",
    "updatesamlprovider",
    "createopenidconnectprovider",
    "updateopenidconnectproviderthumbprint",
    "addclientidtoopenidconnectprovider",
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

/** Remote code / PassRole combinations blocked when role-like params are present (or always, for RCE). */
export const PASSROLE_COMBO_OPS: Record<string, Set<string>> = {
  EC2: new Set([
    "runinstances",
    "associateiaminstanceprofile",
    "replaceiaminstanceprofileassociation",
    "createlaunchtemplate",
    "createlaunchtemplateversion",
    "modifylaunchtemplate",
  ]),
  LAMBDA: new Set([
    "updatefunctionconfiguration",
    "createeventsourcemapping",
    "createfunction",
  ]),
  ECS: new Set([
    "registertaskdefinition",
    "runtask",
  ]),
  SSM: new Set([
    "sendcommand",
    "send",
    "startsession",
  ]),
  KMS: new Set([
    "creategrant",
    "putkeypolicy",
  ]),
};

const ALWAYS_BLOCK_PASSROLE_OPS = new Set([
  "associateiaminstanceprofile",
  "replaceiaminstanceprofileassociation",
  "createeventsourcemapping",
  "sendcommand",
  "send",
  "startsession",
  "creategrant",
  "putkeypolicy",
]);

const PASSROLE_PARAM_KEYS = new Set([
  "iaminstanceprofile",
  "role",
  "rolearn",
  "executionrolearn",
  "taskrolearn",
]);

/** Secret-returning reads: not auto-allowed even though they match Get*. */
const SECRET_RETURNING_READS: Record<string, Set<string>> = {
  SECRETSMANAGER: new Set(["getsecretvalue"]),
  SSM: new Set(["getparameter", "getparameters", "getparametersbypath", "getparameterhistory"]),
  ECR: new Set(["getauthorizationtoken"]),
  EC2: new Set(["getpassworddata"]),
  LAMBDA: new Set(["getfunction"]),
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

export function normalizeService(service: string): string {
  return String(service || "").trim();
}

export function isReadOnlyOperation(operation: string): boolean {
  const op = normalizeOperation(operation);
  return READ_ONLY_RE.test(op);
}

function operationAliases(operation: string): string[] {
  const raw = String(operation || "").trim().toLowerCase();
  const stripped = stripCommandSuffix(raw).toLowerCase();
  return raw === stripped ? [stripped] : [stripped, raw];
}

function setHasOp(set: Set<string> | undefined, operation: string): boolean {
  if (!set) return false;
  return operationAliases(operation).some((op) => set.has(op));
}

function walkParams(value: unknown, visit: (key: string, val: unknown) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkParams(item, visit);
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    visit(key, val);
    walkParams(val, visit);
  }
}

export function hasPassRoleParam(params: unknown): boolean {
  let found = false;
  walkParams(params, (key, val) => {
    if (found) return;
    if (!PASSROLE_PARAM_KEYS.has(key.toLowerCase())) return;
    if (val === undefined || val === null || val === false || val === "") return;
    found = true;
  });
  return found;
}

export function isPrivilegeEscalation(service: string, operation: string, params?: unknown): boolean {
  const svc = String(service || "").toUpperCase();
  if (setHasOp(PRIVILEGE_ESCALATION_OPS[svc], operation)) return true;

  const combo = PASSROLE_COMBO_OPS[svc];
  if (setHasOp(combo, operation)) {
    if (operationAliases(operation).some((op) => ALWAYS_BLOCK_PASSROLE_OPS.has(op))) return true;
    if (hasPassRoleParam(params)) return true;
  }
  return false;
}

function isDefenseEvasion(service: string, operation: string, params?: unknown): boolean {
  const svc = String(service || "").toUpperCase();
  const op = normalizeOperation(operation).toLowerCase();
  if (setHasOp(DEFENSE_EVASION_OPS[svc], operation)) return true;
  if (svc === "GUARDDUTY" && setHasOp(new Set(["updatedetector"]), operation) && isGuardDutyDisable(params)) return true;
  return false;
}

function isGuardDutyDisable(params: unknown): boolean {
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (p.Enable === false || p.enable === false) return true;
  const status = String(p.DetectorStatus || p.detectorStatus || "").toUpperCase();
  return status === "DISABLED";
}

function isSsmDecryptRead(operation: string, params: unknown): boolean {
  const op = normalizeOperation(operation).toLowerCase();
  if (!["getparameter", "getparameters", "getparametersbypath", "getparameterhistory"].includes(op)) return false;
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  return p.WithDecryption === true || p.withDecryption === true;
}

export function callerAccountMatchesPending(
  callerAccount: string | undefined | null,
  pendingAccount: string | undefined | null,
): boolean {
  const caller = String(callerAccount || "").trim();
  const pending = String(pendingAccount || "").trim();
  if (!/^\d{12}$/.test(caller) || !/^\d{12}$/.test(pending)) return false;
  return caller === pending;
}

export interface PlatformAllowlistContext {
  targetAccountId?: string | null;
}

export function isSecretReturningRead(service: string, operation: string, params?: unknown): boolean {
  const svc = String(service || "").toUpperCase();
  const op = normalizeOperation(operation).toLowerCase();
  const ops = SECRET_RETURNING_READS[svc];
  if (!setHasOp(ops, operation)) return false;
  if (svc === "SSM") return isSsmDecryptRead(operation, params);
  return true;
}

export function classifyAwsOperation(
  service: string,
  operation: string,
  params?: unknown,
): CommandDecision {
  const normalizedService = normalizeService(service);
  const normalizedOperation = normalizeOperation(operation);
  const normalizedCommand = /Command$/i.test(String(operation || ""))
    ? String(operation)
    : `${normalizedOperation.charAt(0).toUpperCase()}${normalizedOperation.slice(1)}Command`;
  const opLower = normalizedOperation.toLowerCase();
  const svcUpper = normalizedService.toUpperCase();

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

  if (DESTRUCTIVE_OPERATIONS.has(opLower) || isDefenseEvasion(normalizedService, operation, params)) {
    return {
      allowed: false,
      requiresApproval: false,
      riskLevel: "BLOCKED",
      reason: `Operation '${normalizedService}.${normalizedOperation}' is permanently blocked because it can cause irreversible account damage or disable security telemetry.`,
      normalizedService,
      normalizedOperation,
      normalizedCommand,
    };
  }

  if (isPrivilegeEscalation(normalizedService, operation, params)) {
    return {
      allowed: false,
      requiresApproval: false,
      riskLevel: "BLOCKED",
      reason: `Operation '${normalizedService}.${normalizedOperation}' is blocked because it can escalate IAM privileges or execute untrusted code.`,
      normalizedService,
      normalizedOperation,
      normalizedCommand,
    };
  }

  if (isSecretReturningRead(normalizedService, operation, params)) {
    return {
      allowed: false,
      requiresApproval: true,
      riskLevel: "REQUIRES_APPROVAL",
      reason: `Operation '${normalizedService}.${normalizedOperation}' returns secret material and requires an explicit UI approval.`,
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

function parseSnsTopicArn(value: string): { accountId: string; name: string } | null {
  const match = /^arn:aws:sns:[a-z0-9-]+:(\d{12}):(.+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  return { accountId: match[1], name: match[2] };
}

function snsTopicNameAllowed(name: string, targetAccountId?: string | null): boolean {
  const topic = String(name || "").trim();
  if (!topic) return false;
  if (topic === PLATFORM_SNS_ALERT_TOPIC) return true;
  if (targetAccountId) return topic === `${PLATFORM_SNS_TOPIC_PREFIX}${targetAccountId}`;
  return topic.startsWith(PLATFORM_SNS_TOPIC_PREFIX);
}

function snsTopicAllowed(nameOrArn: string, targetAccountId?: string | null): boolean {
  const value = String(nameOrArn || "").trim();
  if (!value) return false;
  const arn = parseSnsTopicArn(value);
  if (arn) {
    if (!targetAccountId || arn.accountId !== targetAccountId) return false;
    return snsTopicNameAllowed(arn.name, targetAccountId);
  }
  if (value.toLowerCase().startsWith("arn:")) return false;
  return snsTopicNameAllowed(value, targetAccountId);
}

function publicAccessBlockFullyEnabled(params: Record<string, unknown>): boolean {
  const cfg = (params.PublicAccessBlockConfiguration || params.publicAccessBlockConfiguration) as
    | Record<string, unknown>
    | undefined;
  if (!cfg || typeof cfg !== "object") return false;
  return cfg.BlockPublicAcls === true
    && cfg.IgnorePublicAcls === true
    && cfg.BlockPublicPolicy === true
    && cfg.RestrictPublicBuckets === true;
}

function auditBucketAllowed(bucket: string): boolean {
  return String(bucket || "").startsWith(PLATFORM_WORM_BUCKET_PREFIX);
}

export function isPlatformAllowlisted(
  purpose: PlatformPurpose | string | undefined,
  service: string,
  operation: string,
  params?: unknown,
  ctx?: PlatformAllowlistContext,
): boolean {
  if (purpose !== "audit" && purpose !== "notify" && purpose !== "autofix") return false;
  const svc = String(service || "").toUpperCase();
  const op = normalizeOperation(operation).toLowerCase();
  const p = (params && typeof params === "object") ? params as Record<string, unknown> : {};
  const targetAccountId = ctx?.targetAccountId || null;

  if (purpose === "audit") {
    if (svc === "STS" && op === "getcalleridentity") return true;
    if (svc === "CLOUDWATCHLOGS" || svc === "LOGS") {
      if (["createloggroup", "createlogstream", "putlogevents", "describelogstreams"].includes(op)) {
        return p.logGroupName === PLATFORM_AUDIT_LOG_GROUP;
      }
    }
    if (svc === "S3") {
      const bucket = String(p.Bucket || p.bucket || "");
      if (["createbucket", "putobject", "putobjectlockconfiguration", "putpublicaccessblock", "putbucketencryption"].includes(op)) {
        if (op === "putpublicaccessblock" && !publicAccessBlockFullyEnabled(p)) return false;
        return auditBucketAllowed(bucket);
      }
    }
    return false;
  }

  if (purpose === "notify") {
    if (svc === "STS" && op === "getcalleridentity") return true;
    if (svc === "SNS") {
      if (op === "createtopic") return snsTopicAllowed(String(p.Name || p.name || ""), targetAccountId);
      if (["subscribe", "publish", "listsubscriptionsbytopic"].includes(op)) {
        return snsTopicAllowed(String(p.TopicArn || p.topicArn || ""), targetAccountId);
      }
      if (op === "listtopics") return true;
    }
    return false;
  }

  // autofix: standing user-configured policy; still refuse BLOCKED ops via classify first.
  if (svc === "S3" && op === "putpublicaccessblock") {
    return typeof (p.Bucket || p.bucket) === "string" && String(p.Bucket || p.bucket).length > 0 && publicAccessBlockFullyEnabled(p);
  }
  if (svc === "S3" && op === "putbucketencryption") return typeof (p.Bucket || p.bucket) === "string";
  if (svc === "CLOUDTRAIL" && op === "startlogging") return true;
  if (svc === "EC2" && op === "revokesecuritygroupingress") return true;
  return false;
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
