// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const ENV = {
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
};

// ── AWS Executor Proxy ──────────────────────────────────────────────────────
// Delegates all AWS SDK calls to the aws-executor edge function to avoid
// bundling 40+ @aws-sdk/client-* packages in this function.
const EXECUTOR_URL = `${ENV.supabaseUrl}/functions/v1/aws-executor`;

async function awsExec(service: string, commandName: string, config: any, params: any): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(EXECUTOR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
        apikey: ENV.supabaseServiceRoleKey,
      },
      body: JSON.stringify({ service, commandName, config, params }),
    });
  } catch (netErr: any) {
    const err: any = new Error(`Network error reaching aws-executor: ${netErr?.message || netErr}`);
    err.name = "ExecutorNetworkError";
    err.code = "EXECUTOR_NETWORK_ERROR";
    throw err;
  }
  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    data = { error: `aws-executor returned non-JSON (status ${resp.status})` };
  }
  if (data && data.error) {
    const err: any = new Error(String(data.error));
    err.name = data.name || "Error";
    err.code = data.code || "UNKNOWN";
    err.$metadata = { httpStatusCode: data.statusCode || 500 };
    err.statusCode = data.statusCode || 500;
    throw err;
  }
  return data?.result ?? {};
}

// v2-compatible Proxy wrapper: allows `v2Client("IAM", config).listUsers({}).promise()`
function v2Client(service: string, config: any): any {
  return new Proxy({}, {
    get(_target, method: string) {
      if (method === "then" || method === "catch" || typeof method === "symbol") return undefined;
      return (params: any = {}) => ({
        promise: async () => {
          const commandName = method.charAt(0).toUpperCase() + method.slice(1) + "Command";
          return awsExec(service, commandName, config, params);
        },
      });
    },
  });
}

// Direct v3 send helper
async function v3Send(service: string, commandName: string, config: any, params: any): Promise<any> {
  return awsExec(service, commandName, config, params);
}


type ErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "aws_retryable"
  | "aws_non_retryable"
  | "conflict"
  | "configuration"
  | "internal";

class CloudPilotError extends Error {
  code: string;
  category: ErrorCategory;
  status: number;
  retryable: boolean;

  constructor(message: string, options: {
    code: string;
    category: ErrorCategory;
    status?: number;
    retryable?: boolean;
  }) {
    super(message);
    this.name = "CloudPilotError";
    this.code = options.code;
    this.category = options.category;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAwsError(err: any): boolean {
  const code = String(err?.code || err?.name || "");
  const statusCode = Number(err?.statusCode || err?.$metadata?.httpStatusCode || 0);
  return [
    "Throttling",
    "ThrottlingException",
    "TooManyRequestsException",
    "RequestLimitExceeded",
    "ProvisionedThroughputExceededException",
    "ECONNRESET",
    "NetworkingError",
    "TimeoutError",
    "RequestTimeout",
    "ServiceUnavailable",
  ].includes(code) || statusCode === 429 || statusCode >= 500;
}

async function withAwsRetry<T>(operationName: string, fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableAwsError(err)) {
        throw err;
      }
      await sleep(250 * Math.pow(2, attempt - 1));
      console.warn(`[CloudPilot] Retrying AWS operation ${operationName} (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }
  throw lastError;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(",")}}`;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toCloudPilotError(err: any): CloudPilotError {
  if (err instanceof CloudPilotError) return err;
  const code = String(err?.code || err?.name || "INTERNAL_ERROR");
  if (isRetryableAwsError(err)) {
    return new CloudPilotError(err?.message || "A temporary AWS error occurred. Please retry.", {
      code,
      category: "aws_retryable",
      status: 503,
      retryable: true,
    });
  }
  if (code.includes("AccessDenied") || code.includes("Unauthorized")) {
    return new CloudPilotError(err?.message || "AWS rejected the requested operation.", {
      code,
      category: "authorization",
      status: 403,
    });
  }
  return new CloudPilotError(err?.message || "An unexpected internal error occurred.", {
    code,
    category: "internal",
    status: 500,
  });
}

async function claimIdempotencyKey(
  supabaseAdmin: any,
  userId: string | null,
  operationName: string,
  requestKey: string,
  requestHash: string,
) {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("automation_idempotency_keys")
    .select("*")
    .eq("operation_name", operationName)
    .eq("request_key", requestKey)
    .maybeSingle();

  if (fetchError) throw new CloudPilotError(`Failed to check idempotency state: ${fetchError.message}`, {
    code: "IDEMPOTENCY_LOOKUP_FAILED",
    category: "internal",
  });

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new CloudPilotError("An idempotency key collision was detected for a different request.", {
        code: "IDEMPOTENCY_CONFLICT",
        category: "conflict",
        status: 409,
      });
    }
    return { existing };
  }

  const { error: insertError } = await supabaseAdmin.from("automation_idempotency_keys").insert({
    user_id: userId,
    operation_name: operationName,
    request_key: requestKey,
    request_hash: requestHash,
    status: "pending",
  });

  if (insertError) {
    throw new CloudPilotError(`Failed to create idempotency record: ${insertError.message}`, {
      code: "IDEMPOTENCY_INSERT_FAILED",
      category: "internal",
    });
  }

  return { existing: null };
}

async function storeIdempotencySuccess(supabaseAdmin: any, operationName: string, requestKey: string, responsePayload: unknown) {
  await supabaseAdmin.from("automation_idempotency_keys").update({
    status: "success",
    response_payload: responsePayload,
    updated_at: new Date().toISOString(),
  }).eq("operation_name", operationName).eq("request_key", requestKey);
}

async function storeIdempotencyFailure(supabaseAdmin: any, operationName: string, requestKey: string, errorPayload: unknown) {
  await supabaseAdmin.from("automation_idempotency_keys").update({
    status: "failed",
    error_payload: errorPayload,
    updated_at: new Date().toISOString(),
  }).eq("operation_name", operationName).eq("request_key", requestKey);
}



const IPV4_ANYWHERE = "0.0.0.0/0";
const IPV6_ANYWHERE = "::/0";

type UnifiedAuditIntent = "full_audit" | "security_audit" | "cost_audit" | "compliance" | "single_service";
type UnifiedAuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
type UnifiedAuditScanner = "iam" | "s3" | "sg" | "ec2" | "cost";

interface UnifiedAuditPlan {
  intent: UnifiedAuditIntent;
  scanners: UnifiedAuditScanner[];
  scope: string;
  filters: Record<string, string>;
  format: "summary" | "detailed" | "exportable";
  rawQuery: string;
}

interface UnifiedFinding {
  id: string;
  service: string;
  severity: UnifiedAuditSeverity;
  title: string;
  resource: string;
  detail: string;
  fix_prompt: string;
  remediation: string;
  tags: Record<string, string>;
  timestamp: string;
}

interface UnifiedScannerResult {
  findings: UnifiedFinding[];
  limitations: string[];
  resourcesEvaluated: number;
  servicesAssessed: string[];
}

interface CostRule {
  rule_id: string;
  type: "daily_threshold" | "multiplier_spike";
  threshold?: number;
  multiplier?: number;
  scope: string;
  action: "notify" | "auto_stop_idle_ec2" | "require_confirm";
  requires_confirm: boolean;
  channels: string[];
  created: string;
  raw_query: string;
}

interface CostEntry {
  date: string;
  label: string;
  amount: number;
  unit: string;
}

interface CostAnomaly {
  type: string;
  service: string;
  today?: number;
  mean?: number;
  z_score?: number;
  threshold?: number;
  actual?: number;
  growth_pct?: number;
  severity: UnifiedAuditSeverity;
}

interface CostRemediation {
  action: string;
  resource: string;
  saving: number;
  auto: boolean;
  prompt: string;
}

type DriftScope = "full" | "security_groups" | "iam" | "s3";
type DriftChangeType = "ADDED" | "MODIFIED" | "DELETED";

interface ResourceSnapshot {
  resource_id: string;
  resource_type: string;
  account_id: string;
  region: string;
  state: Record<string, any>;
  fingerprint: string;
  captured_at: string;
}

interface DriftEventRecord {
  id: string;
  user_id: string;
  account_id: string;
  region: string;
  resource_id: string;
  resource_type: string;
  change_type: DriftChangeType;
  severity: UnifiedAuditSeverity;
  title: string;
  baseline_state: Record<string, any> | null;
  current_state: Record<string, any> | null;
  diff: Record<string, any>;
  explanation: string;
  fix_prompt: string;
  resolved: boolean;
  detected_at: string;
}

interface DriftScanResult {
  scope: DriftScope;
  accountId: string;
  baselineCount: number;
  snapshotCount: number;
  driftCount: number;
  healthScore: number;
  events: DriftEventRecord[];
  digest: string;
  generatedAt: string;
}

type OrgQueryType =
  | "accounts_without_mfa"
  | "accounts_with_public_s3"
  | "list_org_scps"
  | "untagged_env_accounts"
  | "org_structure"
  | "guardian_onboarding_status";

type OrgOperationAction = "attach_scp";
type OrgScpTemplate =
  | "deny_non_approved_regions"
  | "deny_root_account_usage"
  | "require_mfa_for_all_actions"
  | "deny_leaving_org"
  | "enforce_s3_encryption";

interface OrgAccountSummary {
  id: string;
  name: string;
  email: string;
  env: string;
  team: string;
  ou: string;
  tags: Record<string, string>;
}

interface OrgScopeResolution {
  scope: string;
  accounts: OrgAccountSummary[];
}

interface OrgBlastRadiusResult {
  blocked: string[];
  warnings: string[];
  by_env: Record<string, number>;
  total: number;
  safe_to_proceed: boolean;
  highestRiskEnv: string;
}

interface OrgAccountResult {
  account_id: string;
  account_name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  action_taken: string;
  error?: string;
  duration_ms: number;
}

interface OrgQueryResult {
  queryType: OrgQueryType;
  scope: string;
  totalAccountsConsidered: number;
  formalReport: string;
  results: Record<string, any>;
  generatedAt: string;
}

type RunbookStepRisk = "auto" | "confirm" | "manual";
type RunbookStepType = "aws_action" | "query" | "notify" | "wait" | "branch" | "human_task";
type RunbookExecutionStatus =
  | "PLANNED"
  | "IN_PROGRESS"
  | "WAITING_CONFIRMATION"
  | "COMPLETED"
  | "ABORTED"
  | "FAILED_ABORTED"
  | "ROLLED_BACK"
  | "DRY_RUN_COMPLETED";

interface RunbookStepTemplate {
  id: string;
  name: string;
  type: RunbookStepType;
  risk: RunbookStepRisk;
  action: string;
  params: Record<string, any>;
  rollback?: {
    action: string;
    params: Record<string, any> | string;
  } | null;
  on_failure?: "pause" | "skip" | "abort" | "rollback_all";
  timeout_sec?: number;
  depends_on?: string[];
}

interface RunbookTemplate {
  id: string;
  name: string;
  description: string;
  trigger: string;
  steps: RunbookStepTemplate[];
  tags: string[];
}

interface ResolvedRunbookStep extends RunbookStepTemplate {
  human_readable: string;
  estimated_impact: string;
}

interface RunbookExecutionRecord {
  id: string;
  user_id: string;
  conversation_id: string | null;
  runbook_id: string;
  runbook_name: string;
  trigger_query: string;
  dry_run: boolean;
  status: RunbookExecutionStatus;
  current_step_index: number;
  steps: ResolvedRunbookStep[];
  results: Array<Record<string, any>>;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  last_error: string | null;
}

type EventResponseType = "auto_fix" | "notify" | "runbook" | "all";

interface EventResponsePolicyRecord {
  id: string;
  policy_id: string;
  name: string;
  trigger_event: string;
  trigger_conditions: Record<string, any>;
  risk_threshold: UnifiedAuditSeverity;
  response_type: EventResponseType;
  response_action: string;
  response_params: Record<string, any>;
  notify_channels: string[];
  raw_query: string;
  created_by: string;
  is_active: boolean;
  built_in?: boolean;
}

interface EnrichedEvent {
  event_id: string;
  event_name: string;
  event_time: string;
  actor_arn: string;
  actor_type: string;
  actor_is_guardian: boolean;
  source_ip: string;
  resource_id: string;
  resource_type: string;
  region: string;
  risk_level: UnifiedAuditSeverity;
  risk_reason: string;
  requested_ports: number[];
  source_cidrs: string[];
  raw_event: Record<string, any>;
}

interface EventReplayMatch {
  event: EnrichedEvent;
  policies: EventResponsePolicyRecord[];
}

interface EventReplayResult {
  hoursBack: number;
  totalEvents: number;
  watchedEvents: number;
  deduplicatedEvents: number;
  matchedEvents: number;
  policiesEvaluated: number;
  matches: EventReplayMatch[];
  formalReport: string;
  generatedAt: string;
}

const SEVERITY_ORDER: Record<UnifiedAuditSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

function calculateAccountHealthScore(counts: Record<UnifiedAuditSeverity, number>): number {
  const critDeduct = Math.min(60, (counts.CRITICAL || 0) * 20);
  const highDeduct = Math.min(45, (counts.HIGH || 0) * 8);
  const medDeduct = Math.min(30, (counts.MEDIUM || 0) * 3);
  const lowDeduct = Math.min(15, (counts.LOW || 0) * 1);
  const score = 100 - critDeduct - highDeduct - medDeduct - lowDeduct;
  return Math.max(0, score);
}

function parseCostResponse(response: any): CostEntry[] {
  const results: CostEntry[] = [];
  for (const day of response.ResultsByTime || []) {
    const date = day.TimePeriod?.Start || "";
    for (const group of day.Groups || []) {
      results.push({
        date,
        label: group.Keys?.[0] || "Unknown",
        amount: Number(group.Metrics?.UnblendedCost?.Amount || 0),
        unit: group.Metrics?.UnblendedCost?.Unit || "USD",
      });
    }
  }
  return results;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

async function replayCloudTrailEvents(
  supabaseAdmin: any,
  userId: string | null,
  awsConfig: any,
  hoursBack: number,
): Promise<EventReplayResult> {
  const replayedEvents = await fetchCloudTrailEventsForReplay(awsConfig, hoursBack);
  const { deduplicated, suppressed } = deduplicateReplayEvents(replayedEvents);
  const userPolicies = userId ? await fetchUserEventResponsePolicies(supabaseAdmin, userId) : [];
  const policies = [...BUILT_IN_EVENT_RESPONSE_POLICIES, ...userPolicies];
  const matches: EventReplayMatch[] = [];

  for (const event of deduplicated) {
    const matchedPolicies = policies.filter((policy) => eventMatchesPolicy(event, policy));
    if (matchedPolicies.length > 0) {
      matches.push({
        event,
        policies: matchedPolicies,
      });
    }
  }

  matches.sort((left, right) => {
    const severityDelta = SEVERITY_ORDER[left.event.risk_level] - SEVERITY_ORDER[right.event.risk_level];
    if (severityDelta !== 0) return severityDelta;
    return left.event.event_time.localeCompare(right.event.event_time);
  });

  const result: EventReplayResult = {
    hoursBack,
    totalEvents: replayedEvents.length,
    watchedEvents: deduplicated.length,
    deduplicatedEvents: suppressed,
    matchedEvents: matches.length,
    policiesEvaluated: policies.length,
    matches,
    formalReport: "",
    generatedAt: new Date().toISOString(),
  };
  result.formalReport = buildFormalEventReplayReport(result);
  return result;
}

function normalizeJsonForFingerprint(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonForFingerprint(item));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const sortedEntries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeJsonForFingerprint(nested)]);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

async function computeStateFingerprint(state: Record<string, any>): Promise<string> {
  const normalized = JSON.stringify(normalizeJsonForFingerprint(state), (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    return value;
  });
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getAwsAccountId(awsConfig: any): Promise<string> {
  const sts = v2Client("STS", awsConfig);
  const identity = await sts.getCallerIdentity({}).promise();
  if (!identity.Account) {
    throw new Error("Unable to resolve the AWS account ID for drift detection.");
  }
  return identity.Account;
}

async function buildResourceSnapshot(
  resourceType: string,
  resourceId: string,
  accountId: string,
  region: string,
  state: Record<string, any>,
): Promise<ResourceSnapshot> {
  return {
    resource_id: resourceId,
    resource_type: resourceType,
    account_id: accountId,
    region,
    state,
    fingerprint: await computeStateFingerprint(state),
    captured_at: new Date().toISOString(),
  };
}

function toIsoString(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

async function captureSecurityGroupSnapshots(awsConfig: any, accountId: string): Promise<ResourceSnapshot[]> {
  const ec2 = v2Client("EC2", awsConfig);
  const snapshots: ResourceSnapshot[] = [];
  const response = await ec2.describeSecurityGroups({ MaxResults: 1000 }).promise();

  for (const sg of response.SecurityGroups || []) {
    if (!sg.GroupId) continue;
    snapshots.push(await buildResourceSnapshot(
      "security_group",
      sg.GroupId,
      accountId,
      awsConfig.region,
      {
        name: sg.GroupName || sg.GroupId,
        ingress_rules: sg.IpPermissions || [],
        egress_rules: sg.IpPermissionsEgress || [],
        tags: Object.fromEntries((sg.Tags || []).filter((tag) => tag.Key).map((tag) => [String(tag.Key), tag.Value || ""])),
        vpc_id: sg.VpcId || null,
      },
    ));
  }

  return snapshots;
}

async function captureIamUserSnapshots(awsConfig: any, accountId: string): Promise<ResourceSnapshot[]> {
  const iam = v2Client("IAM", awsConfig);
  const snapshots: ResourceSnapshot[] = [];
  const response = await iam.listUsers({ MaxItems: 1000 }).promise();

  for (const user of response.Users || []) {
    if (!user.UserName) continue;
    const [policies, mfa, keys] = await Promise.all([
      iam.listAttachedUserPolicies({ UserName: user.UserName, MaxItems: 1000 }).promise(),
      iam.listMFADevices({ UserName: user.UserName }).promise(),
      iam.listAccessKeys({ UserName: user.UserName }).promise(),
    ]);

    snapshots.push(await buildResourceSnapshot(
      "iam_user",
      user.UserName,
      accountId,
      awsConfig.region,
      {
        attached_policies: (policies.AttachedPolicies || []).map((policy) => policy.PolicyName || policy.PolicyArn || "unknown"),
        mfa_enabled: (mfa.MFADevices || []).length > 0,
        access_keys: (keys.AccessKeyMetadata || []).map((key) => ({
          id: key.AccessKeyId || "",
          status: key.Status || "Unknown",
          created: toIsoString(key.CreateDate),
        })),
        created: toIsoString(user.CreateDate),
      },
    ));
  }

  return snapshots;
}

async function captureS3BucketSnapshots(awsConfig: any, accountId: string): Promise<ResourceSnapshot[]> {
  const s3 = v2Client("S3", awsConfig);
  const snapshots: ResourceSnapshot[] = [];
  const response = await s3.listBuckets().promise();

  for (const bucket of response.Buckets || []) {
    if (!bucket.Name) continue;
    const bucketName = bucket.Name;
    let publicAccessBlock: Record<string, any> | null = null;
    let encryptionRules: Record<string, any>[] | null = null;
    let versioning = "Unknown";

    try {
      const pub = await s3.getPublicAccessBlock({ Bucket: bucketName }).promise();
      publicAccessBlock = pub.PublicAccessBlockConfiguration || null;
    } catch {
      publicAccessBlock = null;
    }

    try {
      const enc = await s3.getBucketEncryption({ Bucket: bucketName }).promise();
      encryptionRules = enc.ServerSideEncryptionConfiguration?.Rules || null;
    } catch {
      encryptionRules = null;
    }

    try {
      const ver = await s3.getBucketVersioning({ Bucket: bucketName }).promise();
      versioning = ver.Status || "Disabled";
    } catch {
      versioning = "Unknown";
    }

    snapshots.push(await buildResourceSnapshot(
      "s3_bucket",
      bucketName,
      accountId,
      awsConfig.region,
      {
        public_access_block: publicAccessBlock,
        encryption: encryptionRules,
        versioning,
      },
    ));
  }

  return snapshots;
}

function inferDriftScope(rawQuery: string): DriftScope {
  const query = rawQuery.toLowerCase();
  if (/\bsecurity group\b|\bsg\b|ingress|egress|port\b/.test(query)) return "security_groups";
  if (/\biam\b|access key|mfa|policy\b/.test(query)) return "iam";
  if (/\bs3\b|bucket|versioning|encryption|public access block\b/.test(query)) return "s3";
  return "full";
}

function getDriftResourceTypes(scope: DriftScope): string[] {
  switch (scope) {
    case "security_groups":
      return ["security_group"];
    case "iam":
      return ["iam_user"];
    case "s3":
      return ["s3_bucket"];
    default:
      return ["security_group", "iam_user", "s3_bucket"];
  }
}

async function captureSnapshotsForScope(scope: DriftScope, awsConfig: any, accountId: string): Promise<ResourceSnapshot[]> {
  const snapshots: ResourceSnapshot[] = [];
  if (scope === "full" || scope === "security_groups") {
    snapshots.push(...await captureSecurityGroupSnapshots(awsConfig, accountId));
  }
  if (scope === "full" || scope === "iam") {
    snapshots.push(...await captureIamUserSnapshots(awsConfig, accountId));
  }
  if (scope === "full" || scope === "s3") {
    snapshots.push(...await captureS3BucketSnapshots(awsConfig, accountId));
  }
  return snapshots;
}

async function upsertBaselineSnapshots(
  supabaseAdmin: any,
  userId: string,
  snapshots: ResourceSnapshot[],
) {
  if (snapshots.length === 0) return;
  const rows = snapshots.map((snapshot) => ({
    user_id: userId,
    resource_id: snapshot.resource_id,
    resource_type: snapshot.resource_type,
    account_id: snapshot.account_id,
    region: snapshot.region,
    state: snapshot.state,
    fingerprint: snapshot.fingerprint,
    captured_at: snapshot.captured_at,
    is_baseline: true,
  }));

  const { error } = await supabaseAdmin
    .from("resource_snapshots")
    .upsert(rows, { onConflict: "user_id,resource_id,resource_type,account_id" });
  if (error) {
    throw new Error(`Failed to store baseline snapshots: ${error.message}`);
  }
}

async function fetchBaselineSnapshots(
  supabaseAdmin: any,
  userId: string,
  accountId: string,
  scope: DriftScope,
): Promise<Map<string, any>> {
  const { data, error } = await supabaseAdmin
    .from("resource_snapshots")
    .select("*")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .eq("is_baseline", true);

  if (error) {
    throw new Error(`Failed to fetch baseline snapshots: ${error.message}`);
  }

  const allowedTypes = new Set(getDriftResourceTypes(scope));
  const baselineMap = new Map<string, any>();
  for (const row of data || []) {
    if (!allowedTypes.has(row.resource_type)) continue;
    baselineMap.set(`${row.resource_type}:${row.resource_id}`, row);
  }
  return baselineMap;
}

function computeStructuredDiff(
  baselineState: Record<string, any>,
  currentState: Record<string, any>,
): Record<string, { before: any; after: any }> {
  const diff: Record<string, { before: any; after: any }> = {};
  const keys = new Set([...Object.keys(baselineState || {}), ...Object.keys(currentState || {})]);
  for (const key of keys) {
    const before = baselineState?.[key];
    const after = currentState?.[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff[key] = { before, after };
    }
  }
  return diff;
}

function hasWorldOpenRule(rules: any[] | undefined): boolean {
  for (const rule of rules || []) {
    for (const range of rule?.IpRanges || []) {
      if (range?.CidrIp === IPV4_ANYWHERE) return true;
    }
    for (const range of rule?.Ipv6Ranges || []) {
      if (range?.CidrIpv6 === IPV6_ANYWHERE) return true;
    }
  }
  return false;
}

function isPublicAccessBlockMissingOrDisabled(value: any): boolean {
  if (!value) return true;
  return ![
    value.BlockPublicAcls,
    value.IgnorePublicAcls,
    value.BlockPublicPolicy,
    value.RestrictPublicBuckets,
  ].every(Boolean);
}

function buildDriftExplanation(title: string, changeType: DriftChangeType, resourceId: string): string {
  switch (title) {
    case "World-open inbound rule added to security group":
      return `Security group ${resourceId} now allows internet-originated traffic that was not present in the baseline. This materially increases exposure and should be reviewed immediately.`;
    case "S3 public access block removed":
      return `Bucket ${resourceId} no longer retains the expected public access block configuration. This increases the risk of unintended public exposure.`;
    case "AdministratorAccess policy attached to IAM user":
      return `IAM user ${resourceId} now has full administrative permissions relative to the baseline. This should be validated against least-privilege requirements.`;
    case "MFA disabled on IAM user":
      return `IAM user ${resourceId} no longer has MFA enabled compared with the baseline. This weakens account access controls.`;
    case "Versioning disabled on S3 bucket":
      return `Bucket ${resourceId} no longer has versioning enabled. Recovery options for overwritten or deleted objects are now reduced.`;
    default:
      return `${resourceId} differs from the stored baseline with a ${changeType.toLowerCase()} change that should be reviewed.`;
  }
}

function scoreDriftEvent(
  draft: Omit<DriftEventRecord, "severity" | "title" | "fix_prompt" | "explanation">,
): DriftEventRecord {
  let severity: UnifiedAuditSeverity = "LOW";
  let title = `${draft.resource_type} configuration changed`;
  let fixPrompt = `show me changes to ${draft.resource_id}`;

  if (
    draft.resource_type === "security_group" &&
    draft.change_type === "MODIFIED" &&
    hasWorldOpenRule(draft.diff.ingress_rules?.after)
  ) {
    severity = "CRITICAL";
    title = "World-open inbound rule added to security group";
    fixPrompt = `remove world-open rule from ${draft.resource_id}`;
  } else if (
    draft.resource_type === "s3_bucket" &&
    draft.change_type === "MODIFIED" &&
    isPublicAccessBlockMissingOrDisabled(draft.diff.public_access_block?.after)
  ) {
    severity = "CRITICAL";
    title = "S3 public access block removed";
    fixPrompt = `block all public access on ${draft.resource_id}`;
  } else if (
    draft.resource_type === "iam_user" &&
    draft.change_type === "MODIFIED" &&
    JSON.stringify(draft.diff.attached_policies?.after || []).includes("AdministratorAccess")
  ) {
    severity = "HIGH";
    title = "AdministratorAccess policy attached to IAM user";
    fixPrompt = `review admin access for ${draft.resource_id}`;
  } else if (
    draft.resource_type === "iam_user" &&
    draft.change_type === "MODIFIED" &&
    draft.diff.mfa_enabled?.after === false
  ) {
    severity = "HIGH";
    title = "MFA disabled on IAM user";
    fixPrompt = `re-enable MFA for ${draft.resource_id}`;
  } else if (
    draft.resource_type === "s3_bucket" &&
    draft.change_type === "MODIFIED" &&
    draft.diff.versioning?.after === "Disabled"
  ) {
    severity = "MEDIUM";
    title = "Versioning disabled on S3 bucket";
    fixPrompt = `re-enable versioning on ${draft.resource_id}`;
  } else if (draft.change_type === "ADDED") {
    title = `${draft.resource_type} resource added`;
    fixPrompt = `review new ${draft.resource_type} ${draft.resource_id}`;
  } else if (draft.change_type === "DELETED") {
    title = `${draft.resource_type} resource deleted`;
    fixPrompt = `review deletion of ${draft.resource_id}`;
  }

  return {
    ...draft,
    severity,
    title,
    fix_prompt: fixPrompt,
    explanation: buildDriftExplanation(title, draft.change_type, draft.resource_id),
  };
}

function calculateDriftHealthScore(events: DriftEventRecord[]): number {
  const counts: Record<UnifiedAuditSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const event of events) {
    counts[event.severity] += 1;
  }
  return calculateAccountHealthScore(counts);
}

function buildFormalDriftDigest(result: DriftScanResult): string {
  const lines: string[] = [];
  lines.push("## Drift Detection Report");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Scope: ${result.scope}`);
  lines.push(`Baseline resources evaluated: ${result.baselineCount}`);
  lines.push(`Current snapshots captured: ${result.snapshotCount}`);
  lines.push(`Drift events detected: ${result.driftCount}`);
  lines.push(`Health score: ${result.healthScore}/100`);
  lines.push("");

  if (result.events.length === 0) {
    lines.push("No drift was detected against the stored baseline for the selected scope.");
    return lines.join("\n");
  }

  const grouped = new Map<UnifiedAuditSeverity, DriftEventRecord[]>();
  for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as UnifiedAuditSeverity[]) {
    grouped.set(severity, result.events.filter((event) => event.severity === severity));
  }

  for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as UnifiedAuditSeverity[]) {
    const events = grouped.get(severity) || [];
    if (events.length === 0) continue;
    lines.push(`### ${severity}`);
    lines.push("");
    for (const event of events) {
      lines.push(`- ${event.title} on ${event.resource_id} (${event.change_type}). ${event.explanation} Suggested action: \`${event.fix_prompt}\`.`);
    }
    lines.push("");
  }

  const topSeverity = result.events[0]?.severity || "LOW";
  lines.push(`Overall verdict: The account has ${result.driftCount} unresolved drift event(s). The highest detected severity is ${topSeverity}.`);
  return lines.join("\n");
}

async function persistDriftEvents(supabaseAdmin: any, events: DriftEventRecord[]) {
  if (events.length === 0) return;
  const rows = events.map((event) => ({
    id: event.id,
    user_id: event.user_id,
    account_id: event.account_id,
    region: event.region,
    resource_id: event.resource_id,
    resource_type: event.resource_type,
    change_type: event.change_type,
    severity: event.severity,
    title: event.title,
    baseline_state: event.baseline_state,
    current_state: event.current_state,
    diff: event.diff,
    explanation: event.explanation,
    fix_prompt: event.fix_prompt,
    resolved: event.resolved,
    detected_at: event.detected_at,
  }));

  const { error } = await supabaseAdmin.from("drift_events").insert(rows);
  if (error) {
    throw new Error(`Failed to persist drift events: ${error.message}`);
  }
}

async function runDriftDetection(
  supabaseAdmin: any,
  userId: string,
  rawQuery: string,
  awsConfig: any,
): Promise<DriftScanResult> {
  const scope = inferDriftScope(rawQuery);
  const accountId = await getAwsAccountId(awsConfig);
  const currentSnapshots = await captureSnapshotsForScope(scope, awsConfig, accountId);
  const baselines = await fetchBaselineSnapshots(supabaseAdmin, userId, accountId, scope);

  if (baselines.size === 0) {
    throw new Error("No baseline exists for this scope. Capture a baseline before running drift detection.");
  }

  const currentIds = new Set<string>();
  const events: DriftEventRecord[] = [];

  for (const snapshot of currentSnapshots) {
    const key = `${snapshot.resource_type}:${snapshot.resource_id}`;
    currentIds.add(key);
    const baseline = baselines.get(key);

    if (!baseline) {
      events.push(scoreDriftEvent({
        id: crypto.randomUUID(),
        user_id: userId,
        account_id: accountId,
        region: snapshot.region,
        resource_id: snapshot.resource_id,
        resource_type: snapshot.resource_type,
        change_type: "ADDED",
        baseline_state: null,
        current_state: snapshot.state,
        diff: { new_resource: snapshot.state },
        resolved: false,
        detected_at: new Date().toISOString(),
      }));
      continue;
    }

    if (snapshot.fingerprint !== baseline.fingerprint) {
      const diff = computeStructuredDiff(baseline.state || {}, snapshot.state);
      if (Object.keys(diff).length > 0) {
        events.push(scoreDriftEvent({
          id: crypto.randomUUID(),
          user_id: userId,
          account_id: accountId,
          region: snapshot.region,
          resource_id: snapshot.resource_id,
          resource_type: snapshot.resource_type,
          change_type: "MODIFIED",
          baseline_state: baseline.state || null,
          current_state: snapshot.state,
          diff,
          resolved: false,
          detected_at: new Date().toISOString(),
        }));
      }
    }
  }

  for (const [key, baseline] of baselines.entries()) {
    if (currentIds.has(key)) continue;
    events.push(scoreDriftEvent({
      id: crypto.randomUUID(),
      user_id: userId,
      account_id: accountId,
      region: baseline.region || awsConfig.region,
      resource_id: baseline.resource_id,
      resource_type: baseline.resource_type,
      change_type: "DELETED",
      baseline_state: baseline.state || null,
      current_state: null,
      diff: { deleted_resource: baseline.resource_id },
      resolved: false,
      detected_at: new Date().toISOString(),
    }));
  }

  events.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
  await persistDriftEvents(supabaseAdmin, events);

  const result: DriftScanResult = {
    scope,
    accountId,
    baselineCount: baselines.size,
    snapshotCount: currentSnapshots.length,
    driftCount: events.length,
    healthScore: calculateDriftHealthScore(events),
    events,
    digest: "",
    generatedAt: new Date().toISOString(),
  };
  result.digest = buildFormalDriftDigest(result);
  return result;
}

async function acknowledgeDriftEvent(
  supabaseAdmin: any,
  userId: string,
  driftEventId: string,
): Promise<{ driftEventId: string; resourceId: string; resourceType: string; acknowledgedAt: string }> {
  const { data, error } = await supabaseAdmin
    .from("drift_events")
    .select("*")
    .eq("id", driftEventId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Drift event was not found for acknowledgement.");
  }
  if (!data.current_state) {
    throw new Error("This drift event does not have a current state that can be promoted to baseline.");
  }

  const capturedAt = new Date().toISOString();
  const fingerprint = await computeStateFingerprint(data.current_state);

  const { error: upsertError } = await supabaseAdmin
    .from("resource_snapshots")
    .upsert({
      user_id: userId,
      resource_id: data.resource_id,
      resource_type: data.resource_type,
      account_id: data.account_id,
      region: data.region,
      state: data.current_state,
      fingerprint,
      captured_at: capturedAt,
      is_baseline: true,
    }, { onConflict: "user_id,resource_id,resource_type,account_id" });

  if (upsertError) {
    throw new Error(`Failed to update the baseline snapshot: ${upsertError.message}`);
  }

  const { error: updateError } = await supabaseAdmin
    .from("drift_events")
    .update({
      resolved: true,
      resolved_by: userId,
      resolved_at: capturedAt,
    })
    .eq("id", driftEventId)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(`Failed to resolve the drift event: ${updateError.message}`);
  }

  return {
    driftEventId,
    resourceId: data.resource_id,
    resourceType: data.resource_type,
    acknowledgedAt: capturedAt,
  };
}


function parseCostRuleFromQuery(rawQuery: string, notificationEmail: string | null): CostRule {
  const query = rawQuery.toLowerCase();
  const thresholdMatch = query.match(/\$(\d+(?:\.\d+)?)/);
  const multiplierMatch = query.match(/(\d+(?:\.\d+)?)x/);
  const created = new Date().toISOString().slice(0, 10);
  const channels = notificationEmail ? ["email"] : [];

  if (query.includes("spikes more than") || query.includes("weekly average")) {
    return {
      rule_id: `rule-${crypto.randomUUID().slice(0, 8)}`,
      type: "multiplier_spike",
      multiplier: Number(multiplierMatch?.[1] || 3),
      scope: "per_service",
      action: "notify",
      requires_confirm: true,
      channels,
      created,
      raw_query: rawQuery,
    };
  }

  const threshold = Number(thresholdMatch?.[1] || 0);
  const ec2Scoped = /\bec2\b/.test(query);
  const autoStop = /shut down|stop idle/.test(query) && ec2Scoped;

  return {
    rule_id: `rule-${crypto.randomUUID().slice(0, 8)}`,
    type: "daily_threshold",
    threshold,
    scope: ec2Scoped ? "service:EC2" : "total",
    action: autoStop ? "auto_stop_idle_ec2" : "notify",
    requires_confirm: !autoStop,
    channels,
    created,
    raw_query: rawQuery,
  };
}

async function saveCostRule(supabaseAdmin: any, userId: string, rule: CostRule) {
  const { error } = await supabaseAdmin.from("cost_automation_rules").insert({
    user_id: userId,
    rule_id: rule.rule_id,
    rule_type: rule.type,
    threshold: rule.threshold ?? null,
    multiplier: rule.multiplier ?? null,
    scope: rule.scope,
    action: rule.action,
    requires_confirm: rule.requires_confirm,
    channels: rule.channels,
    raw_query: rule.raw_query,
  });
  if (error) throw new Error(`Failed to save cost rule: ${error.message}`);
}

async function fetchCostRules(supabaseAdmin: any, userId: string): Promise<CostRule[]> {
  const { data, error } = await supabaseAdmin
    .from("cost_automation_rules")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to fetch cost rules: ${error.message}`);

  return (data || []).map((row: any) => ({
    rule_id: row.rule_id,
    type: row.rule_type,
    threshold: row.threshold === null ? undefined : Number(row.threshold),
    multiplier: row.multiplier === null ? undefined : Number(row.multiplier),
    scope: row.scope,
    action: row.action,
    requires_confirm: Boolean(row.requires_confirm),
    channels: Array.isArray(row.channels) ? row.channels : [],
    created: row.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    raw_query: row.raw_query,
  }));
}

async function fetchCostData(awsConfig: any, daysBack = 14) {
  const ce = v2Client("CostExplorer", awsConfig);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - daysBack);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);

  const daily = await ce.getCostAndUsage({
    TimePeriod: { Start: start, End: end },
    Granularity: "DAILY",
    Metrics: ["UnblendedCost"],
    GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
  }).promise();

  const byTag = await ce.getCostAndUsage({
    TimePeriod: { Start: start, End: end },
    Granularity: "DAILY",
    Metrics: ["UnblendedCost"],
    GroupBy: [{ Type: "TAG", Key: "env" }],
  }).promise();

  return {
    daily_by_service: parseCostResponse(daily),
    daily_by_tag: parseCostResponse(byTag),
    period: { start, end },
  };
}

function detectCostAnomalies(dailySpend: CostEntry[], rules: CostRule[]): CostAnomaly[] {
  const anomalies: CostAnomaly[] = [];
  const byService: Record<string, CostEntry[]> = {};
  const byDate: Record<string, number> = {};

  for (const entry of dailySpend) {
    byService[entry.label] ||= [];
    byService[entry.label].push(entry);
    byDate[entry.date] = (byDate[entry.date] || 0) + entry.amount;
  }

  for (const entries of Object.values(byService)) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  const totalDates = Object.keys(byDate).sort();
  const latestDate = totalDates[totalDates.length - 1];
  const totalToday = latestDate ? byDate[latestDate] : 0;

  for (const [service, entries] of Object.entries(byService)) {
    const amounts = entries.map((entry) => entry.amount);
    if (amounts.length < 7) continue;

    const baseline = amounts.slice(0, -1);
    const today = amounts[amounts.length - 1];
    const mean = average(baseline);
    const deviation = stdev(baseline);

    if (deviation > 0) {
      const zScore = (today - mean) / deviation;
      if (zScore > 2.5) {
        anomalies.push({
          type: "statistical_spike",
          service,
          today,
          mean: Number(mean.toFixed(2)),
          z_score: Number(zScore.toFixed(2)),
          severity: zScore > 4 ? "CRITICAL" : "HIGH",
        });
      }
    }

    if (amounts.length >= 3) {
      const last3 = amounts.slice(-3);
      if (last3[0] < last3[1] && last3[1] < last3[2] && last3[0] > 0) {
        const growth = ((last3[2] - last3[0]) / last3[0]) * 100;
        if (growth > 50) {
          anomalies.push({
            type: "accelerating_trend",
            service,
            growth_pct: Number(growth.toFixed(1)),
            severity: "MEDIUM",
          });
        }
      }
    }
  }

  for (const rule of rules) {
    if (rule.type === "daily_threshold" && typeof rule.threshold === "number") {
      if (rule.scope === "total" && totalToday > rule.threshold) {
        anomalies.push({
          type: "threshold_breach",
          service: "Total Spend",
          threshold: rule.threshold,
          actual: Number(totalToday.toFixed(2)),
          severity: "HIGH",
        });
      }

      if (rule.scope === "service:EC2") {
        const ec2Entries = Object.entries(byService).find(([service]) => service.toLowerCase().includes("elastic compute"));
        const ec2Today = ec2Entries?.[1]?.slice(-1)[0]?.amount || 0;
        if (ec2Today > rule.threshold) {
          anomalies.push({
            type: "threshold_breach",
            service: "Amazon EC2",
            threshold: rule.threshold,
            actual: Number(ec2Today.toFixed(2)),
            severity: "HIGH",
          });
        }
      }
    }

    if (rule.type === "multiplier_spike" && typeof rule.multiplier === "number") {
      for (const [service, entries] of Object.entries(byService)) {
        if (entries.length < 7) continue;
        const amounts = entries.map((entry) => entry.amount);
        const baseline = amounts.slice(0, -1);
        const today = amounts[amounts.length - 1];
        const mean = average(baseline);
        if (mean > 0 && today / mean >= rule.multiplier) {
          anomalies.push({
            type: "multiplier_spike",
            service,
            today: Number(today.toFixed(2)),
            mean: Number(mean.toFixed(2)),
            severity: today / mean >= rule.multiplier * 1.5 ? "CRITICAL" : "HIGH",
          });
        }
      }
    }
  }

  const deduped = new Map<string, CostAnomaly>();
  for (const anomaly of anomalies) {
    const key = `${anomaly.type}|${anomaly.service}|${anomaly.severity}|${anomaly.threshold ?? ""}|${anomaly.actual ?? ""}|${anomaly.z_score ?? ""}|${anomaly.growth_pct ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, anomaly);
  }
  return [...deduped.values()];
}

const INSTANCE_HOURLY_COST_HINTS: Record<string, number> = {
  "t3.micro": 0.0104,
  "t3.small": 0.0208,
  "t3.medium": 0.0416,
  "t3.large": 0.0832,
  "t3.xlarge": 0.1664,
  "m5.large": 0.096,
  "m5.xlarge": 0.192,
};

function getEc2HourlyCost(instanceType: string | undefined): number {
  if (!instanceType) return 0;
  return INSTANCE_HOURLY_COST_HINTS[instanceType] || 0;
}

async function findIdleEc2Instances(awsConfig: any, thresholdCpu = 2.0, lookbackHours = 24) {
  const ec2 = v2Client("EC2", awsConfig);
  const cloudWatch = v2Client("CloudWatch", awsConfig);
  const idle: Array<{ id: string; type: string; avg_cpu: number; tags: Record<string, string>; hourly_cost: number }> = [];

  const response = await ec2.describeInstances({
    Filters: [{ Name: "instance-state-name", Values: ["running"] }],
    MaxResults: 1000,
  }).promise();

  for (const reservation of response.Reservations || []) {
    for (const instance of reservation.Instances || []) {
      if (!instance.InstanceId) continue;
      const tags = summarizeTags(instance.Tags);
      if ((tags.env || tags.environment) === "prod") continue;

      const metrics = await cloudWatch.getMetricStatistics({
        Namespace: "AWS/EC2",
        MetricName: "CPUUtilization",
        Dimensions: [{ Name: "InstanceId", Value: instance.InstanceId }],
        StartTime: new Date(Date.now() - lookbackHours * 60 * 60 * 1000),
        EndTime: new Date(),
        Period: 3600,
        Statistics: ["Average"],
      }).promise();

      const datapoints = metrics.Datapoints || [];
      if (datapoints.length === 0) continue;
      const avgCpu = average(datapoints.map((point) => point.Average || 0));

      if (avgCpu < thresholdCpu) {
        idle.push({
          id: instance.InstanceId,
          type: instance.InstanceType || "unknown",
          avg_cpu: Number(avgCpu.toFixed(2)),
          tags,
          hourly_cost: getEc2HourlyCost(instance.InstanceType),
        });
      }
    }
  }

  return idle;
}

function classifyCostRemediations(anomalies: CostAnomaly[], idleInstances: Awaited<ReturnType<typeof findIdleEc2Instances>>): CostRemediation[] {
  const remediations: CostRemediation[] = [];

  if (anomalies.some((anomaly) => anomaly.service === "Amazon EC2" || anomaly.service === "Amazon Elastic Compute Cloud - Compute")) {
    for (const instance of idleInstances) {
      const dailySaving = Number((instance.hourly_cost * 24).toFixed(2));
      remediations.push({
        action: "stop_idle_ec2",
        resource: instance.id,
        saving: dailySaving,
        auto: (instance.tags.env || instance.tags.environment) !== "prod",
        prompt: `Stop idle instance ${instance.id}? Saves approximately $${dailySaving.toFixed(2)}/day`,
      });
    }
  }

  return remediations;
}


function normalizeSeverityForUi(severity: UnifiedAuditSeverity): "critical" | "high" | "medium" | "low" {
  switch (severity) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    default:
      return "low";
  }
}

function makeFinding(input: Omit<UnifiedFinding, "id" | "timestamp">): UnifiedFinding {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...input,
  };
}

function planUnifiedAudit(rawQuery: string): UnifiedAuditPlan {
  const query = rawQuery.toLowerCase();
  const filters: Record<string, string> = {};

  if (/\bprod|production\b/.test(query)) filters.env = "prod";
  if (/\bdev|development\b/.test(query)) filters.env = "dev";
  if (/\bstage|staging\b/.test(query)) filters.env = "staging";

  const format: UnifiedAuditPlan["format"] =
    /\bexport|csv|pdf\b/.test(query) ? "exportable" :
    /\bdetailed|detail|deep\b/.test(query) ? "detailed" :
    "summary";

  const byService: Array<{ pattern: RegExp; scanner: UnifiedAuditScanner }> = [
    { pattern: /\biam\b|access key|mfa|administratoraccess/, scanner: "iam" },
    { pattern: /\bs3\b|bucket|lifecycle|public access block/, scanner: "s3" },
    { pattern: /\bsecurity group\b|\bsg\b|ingress|egress|port 22|port 443/, scanner: "sg" },
    { pattern: /\bec2\b|\bvpc\b|instance|ebs|imdsv2/, scanner: "ec2" },
    { pattern: /\bcost\b|spend|waste|wasting|idle/, scanner: "cost" },
  ];

  const matchedScanners = [...new Set(
    byService.filter((entry) => entry.pattern.test(query)).map((entry) => entry.scanner),
  )];

  let intent: UnifiedAuditIntent = "security_audit";
  let scanners: UnifiedAuditScanner[] = ["iam", "s3", "sg"];

  if (/\beverything wrong\b|\bshow me everything\b|\bfull audit\b|\bfull scan\b/.test(query)) {
    intent = "full_audit";
    scanners = ["iam", "s3", "sg", "ec2", "cost"];
  } else if (/\bcost\b|spend|wasting|waste/.test(query)) {
    intent = "cost_audit";
    scanners = matchedScanners.length > 0 ? matchedScanners : ["cost", "ec2"];
  } else if (/\bcompliance\b|\bsoc ?2\b|\bcis\b|\bnist\b|\bpci\b|\bhipaa\b|\biso\b/.test(query)) {
    intent = "compliance";
    scanners = matchedScanners.length > 0 ? matchedScanners : ["iam", "s3", "sg", "ec2"];
  } else if (matchedScanners.length === 1) {
    intent = "single_service";
    scanners = matchedScanners;
  } else if (matchedScanners.length > 1) {
    intent = "security_audit";
    scanners = matchedScanners;
  }

  return {
    intent,
    scanners,
    scope: "all",
    filters,
    format,
    rawQuery,
  };
}

function tagMatchesFilters(tags: Record<string, string>, filters: Record<string, string>): boolean {
  if (!filters.env) return true;
  const env = (tags.env || tags.environment || tags.stage || "").toLowerCase();
  return env === filters.env;
}

function filterFindings(findings: UnifiedFinding[], filters: Record<string, string>): UnifiedFinding[] {
  return findings.filter((finding) => tagMatchesFilters(finding.tags, filters));
}

function dedupeFindings(findings: UnifiedFinding[]): UnifiedFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [finding.service, finding.severity, finding.title, finding.resource, finding.remediation].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scanIam(awsConfig: any): Promise<UnifiedScannerResult> {
  const iam = v2Client("IAM", awsConfig);
  const findings: UnifiedFinding[] = [];
  const limitations: string[] = [];
  let resourcesEvaluated = 0;

  try {
    const users = await iam.listUsers({ MaxItems: 1000 }).promise();
    const userList = users.Users || [];
    resourcesEvaluated = userList.length;

    const scanPromises = userList.map(async (user) => {
      const userName = user.UserName;
      if (!userName) return null;

      const localFindings: UnifiedFinding[] = [];
      const resourceLabel = `${userName}${user.Arn ? ` (${user.Arn})` : ""}`;

      try {
        const attached = await iam.listAttachedUserPolicies({ UserName: userName, MaxItems: 1000 }).promise();
        for (const policy of attached.AttachedPolicies || []) {
          if (policy.PolicyName === "AdministratorAccess") {
            localFindings.push(makeFinding({
              service: "iam",
              severity: "HIGH",
              title: `User ${userName} has full AdministratorAccess`,
              resource: resourceLabel,
              detail: `IAM user ${userName} has the AWS managed AdministratorAccess policy attached.`,
              fix_prompt: `remove AdministratorAccess from ${userName}`,
              remediation: "detach_user_policy",
              tags: {},
            }));
          }
        }
      } catch (err: any) {
        limitations.push(`IAM attached policy enumeration failed for ${userName}: ${err.message}`);
      }

      try {
        const mfa = await iam.listMFADevices({ UserName: userName }).promise();
        if ((mfa.MFADevices || []).length === 0) {
          localFindings.push(makeFinding({
            service: "iam",
            severity: "MEDIUM",
            title: `User ${userName} has no MFA enabled`,
            resource: resourceLabel,
            detail: `IAM user ${userName} has no MFA devices registered.`,
            fix_prompt: `enforce MFA for ${userName}`,
            remediation: "enforce_mfa",
            tags: {},
          }));
        }
      } catch (err: any) {
        limitations.push(`IAM MFA enumeration failed for ${userName}: ${err.message}`);
      }

      try {
        const keys = await iam.listAccessKeys({ UserName: userName }).promise();
        for (const key of keys.AccessKeyMetadata || []) {
          if (!key.CreateDate) continue;
          const ageDays = Math.floor((Date.now() - key.CreateDate.getTime()) / (1000 * 60 * 60 * 24));
          if (ageDays > 90) {
            localFindings.push(makeFinding({
              service: "iam",
              severity: "MEDIUM",
              title: `Access key for ${userName} is ${ageDays} days old`,
              resource: resourceLabel,
              detail: `Access key ${key.AccessKeyId || "(unknown)"} for IAM user ${userName} is older than 90 days.`,
              fix_prompt: `rotate access keys for ${userName}`,
              remediation: "rotate_access_keys",
              tags: {},
            }));
          }
        }
      } catch (err: any) {
        limitations.push(`IAM access key enumeration failed for ${userName}: ${err.message}`);
      }

      return localFindings;
    });

    const results = await Promise.all(scanPromises);
    for (const r of results) {
      if (r) findings.push(...r);
    }
  } catch (err: any) {
    limitations.push(`IAM scan failed: ${err.message}`);
  }

  return { findings, limitations, resourcesEvaluated, servicesAssessed: ["IAM"] };
}

async function getBucketTags(s3: any, bucketName: string): Promise<Record<string, string>> {
  try {
    const tagging = await s3.getBucketTagging({ Bucket: bucketName }).promise();
    const tags: Record<string, string> = {};
    for (const tag of tagging.TagSet || []) {
      if (tag.Key && tag.Value) tags[tag.Key.toLowerCase()] = tag.Value.toLowerCase();
    }
    return tags;
  } catch {
    return {};
  }
}

async function scanS3(awsConfig: any): Promise<UnifiedScannerResult> {
  const s3 = v2Client("S3", awsConfig);
  const findings: UnifiedFinding[] = [];
  const limitations: string[] = [];
  let resourcesEvaluated = 0;

  try {
    const buckets = await s3.listBuckets().promise();
    const bucketList = buckets.Buckets || [];
    resourcesEvaluated = bucketList.length;

    const scanPromises = bucketList.map(async (bucket) => {
      const bucketName = bucket.Name;
      if (!bucketName) return null;

      const localFindings: UnifiedFinding[] = [];
      const tags = await getBucketTags(s3, bucketName);

      try {
        const pub = await s3.getPublicAccessBlock({ Bucket: bucketName }).promise();
        const cfg = pub.PublicAccessBlockConfiguration || {};
        if (![cfg.BlockPublicAcls, cfg.IgnorePublicAcls, cfg.BlockPublicPolicy, cfg.RestrictPublicBuckets].every(Boolean)) {
          localFindings.push(makeFinding({
            service: "s3",
            severity: "CRITICAL",
            title: `Bucket ${bucketName} has public access exposure`,
            resource: bucketName,
            detail: `Public access block settings for bucket ${bucketName} are not fully enabled.`,
            fix_prompt: `block all public access on ${bucketName}`,
            remediation: "put_public_access_block",
            tags,
          }));
        }
      } catch (err: any) {
        localFindings.push(makeFinding({
          service: "s3",
          severity: "HIGH",
          title: `Bucket ${bucketName} has no public access block configured`,
          resource: bucketName,
          detail: `Bucket ${bucketName} does not have a retrievable Public Access Block configuration.`,
          fix_prompt: `block all public access on ${bucketName}`,
          remediation: "put_public_access_block",
          tags,
        }));
        if (err?.code && err.code !== "NoSuchPublicAccessBlockConfiguration") {
          limitations.push(`S3 public access check returned ${err.message} for ${bucketName}`);
        }
      }

      try {
        await s3.getBucketEncryption({ Bucket: bucketName }).promise();
      } catch {
        localFindings.push(makeFinding({
          service: "s3",
          severity: "MEDIUM",
          title: `Bucket ${bucketName} has no default encryption`,
          resource: bucketName,
          detail: `Bucket ${bucketName} does not have default server-side encryption configured.`,
          fix_prompt: `enable AES-256 encryption on ${bucketName}`,
          remediation: "put_bucket_encryption",
          tags,
        }));
      }

      try {
        await s3.getBucketLifecycleConfiguration({ Bucket: bucketName }).promise();
      } catch {
        localFindings.push(makeFinding({
          service: "s3",
          severity: "LOW",
          title: `Bucket ${bucketName} has no lifecycle policy`,
          resource: bucketName,
          detail: `Bucket ${bucketName} does not have a lifecycle configuration.`,
          fix_prompt: `add a lifecycle policy to ${bucketName}`,
          remediation: "put_bucket_lifecycle_configuration",
          tags,
        }));
      }

      return localFindings;
    });

    const results = await Promise.all(scanPromises);
    for (const r of results) {
      if (r) findings.push(...r);
    }
  } catch (err: any) {
    limitations.push(`S3 scan failed: ${err.message}`);
  }

  return { findings, limitations, resourcesEvaluated, servicesAssessed: ["S3"] };
}

async function scanSecurityGroups(awsConfig: any): Promise<UnifiedScannerResult> {
  const ec2 = v2Client("EC2", awsConfig);
  const findings: UnifiedFinding[] = [];
  const limitations: string[] = [];
  let resourcesEvaluated = 0;

  try {
    const response = await ec2.describeSecurityGroups({ MaxResults: 1000 }).promise();
    for (const sg of response.SecurityGroups || []) {
      if (!sg.GroupId || !sg.GroupName) continue;
      resourcesEvaluated += 1;
      const tags = summarizeTags(sg.Tags);

      for (const rule of sg.IpPermissions || []) {
        const port = rule.FromPort ?? 0;
        for (const ipRange of rule.IpRanges || []) {
          if (ipRange.CidrIp === IPV4_ANYWHERE) {
            findings.push(makeFinding({
              service: "security_groups",
              severity: SENSITIVE_PORTS.has(port) ? "CRITICAL" : "HIGH",
              title: `Port ${port} open to the internet on ${sg.GroupName}`,
              resource: `${sg.GroupId} (${sg.GroupName})`,
              detail: `Inbound ${rule.IpProtocol || "tcp"} ${port}${rule.ToPort && rule.ToPort !== port ? `-${rule.ToPort}` : ""} from 0.0.0.0/0.`,
              fix_prompt: `close port ${port} on ${sg.GroupName}`,
              remediation: "revoke_ingress",
              tags,
            }));
          }
        }
        for (const ipRange of rule.Ipv6Ranges || []) {
          if (ipRange.CidrIpv6 === IPV6_ANYWHERE) {
            findings.push(makeFinding({
              service: "security_groups",
              severity: SENSITIVE_PORTS.has(port) ? "CRITICAL" : "HIGH",
              title: `Port ${port} open to the internet on ${sg.GroupName} via IPv6`,
              resource: `${sg.GroupId} (${sg.GroupName})`,
              detail: `Inbound ${rule.IpProtocol || "tcp"} ${port}${rule.ToPort && rule.ToPort !== port ? `-${rule.ToPort}` : ""} from ::/0.`,
              fix_prompt: `close port ${port} on ${sg.GroupName}`,
              remediation: "revoke_ingress",
              tags,
            }));
          }
        }
      }
    }
  } catch (err: any) {
    limitations.push(`Security group scan failed: ${err.message}`);
  }

  return { findings, limitations, resourcesEvaluated, servicesAssessed: ["EC2.SecurityGroups"] };
}

async function scanEc2(awsConfig: any): Promise<UnifiedScannerResult> {
  const ec2 = v2Client("EC2", awsConfig);
  const findings: UnifiedFinding[] = [];
  const limitations: string[] = [];
  let resourcesEvaluated = 0;

  try {
    const instances = await ec2.describeInstances({ MaxResults: 1000 }).promise();
    for (const reservation of instances.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        if (!instance.InstanceId) continue;
        resourcesEvaluated += 1;
        const tags = summarizeTags(instance.Tags);

        if (instance.PublicIpAddress && instance.MetadataOptions?.HttpTokens !== "required") {
          findings.push(makeFinding({
            service: "ec2",
            severity: "HIGH",
            title: `Instance ${instance.InstanceId} has a public IP and IMDSv2 is not enforced`,
            resource: instance.InstanceId,
            detail: `Instance ${instance.InstanceId} is publicly reachable and has HttpTokens=${instance.MetadataOptions?.HttpTokens || "unknown"}.`,
            fix_prompt: `enforce IMDSv2 on ${instance.InstanceId}`,
            remediation: "modify_instance_metadata_options",
            tags,
          }));
        }
      }
    }

    const volumes = await ec2.describeVolumes({ MaxResults: 1000 }).promise();
    for (const volume of volumes.Volumes || []) {
      if (!volume.VolumeId) continue;
      resourcesEvaluated += 1;
      const tags = summarizeTags(volume.Tags);
      if ((volume.Attachments || []).length === 0 && volume.State === "available") {
        findings.push(makeFinding({
          service: "ec2",
          severity: "LOW",
          title: `Unattached EBS volume ${volume.VolumeId} may represent avoidable cost`,
          resource: volume.VolumeId,
          detail: `EBS volume ${volume.VolumeId} is available but not attached to an instance.`,
          fix_prompt: `review unattached EBS volume ${volume.VolumeId}`,
          remediation: "review_cost_waste",
          tags,
        }));
      }
    }
  } catch (err: any) {
    limitations.push(`EC2 scan failed: ${err.message}`);
  }

  return { findings, limitations, resourcesEvaluated, servicesAssessed: ["EC2", "EBS"] };
}

async function scanCost(awsConfig: any): Promise<UnifiedScannerResult> {
  const findings: UnifiedFinding[] = [];
  const limitations: string[] = [];
  let resourcesEvaluated = 0;

  try {
    const ce = v2Client("CostExplorer", awsConfig);
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);

    const cost = await ce.getCostAndUsage({
      TimePeriod: {
        Start: start.toISOString().slice(0, 10),
        End: end.toISOString().slice(0, 10),
      },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
    }).promise();

    for (const period of cost.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const serviceName = group.Keys?.[0] || "Unknown Service";
        const amount = Number(group.Metrics?.UnblendedCost?.Amount || 0);
        resourcesEvaluated += 1;
        if (amount >= 100) {
          findings.push(makeFinding({
            service: "cost",
            severity: amount >= 1000 ? "HIGH" : "MEDIUM",
            title: `${serviceName} incurred elevated spend over the last 30 days`,
            resource: serviceName,
            detail: `Estimated unblended cost for ${serviceName} over the last 30 days is $${amount.toFixed(2)}.`,
            fix_prompt: `review ${serviceName} cost drivers`,
            remediation: "analyze_cost",
            tags: {},
          }));
        }
      }
    }
  } catch (err: any) {
    limitations.push(`Cost scan failed: ${err.message}`);
  }

  return { findings, limitations, resourcesEvaluated, servicesAssessed: ["CostExplorer"] };
}

async function runUnifiedAuditFresh(rawQuery: string, awsConfig: any) {
  const plan = planUnifiedAudit(rawQuery);
  const scannerRuns: Array<Promise<UnifiedScannerResult>> = [];

  if (plan.scanners.includes("iam")) scannerRuns.push(scanIam(awsConfig));
  if (plan.scanners.includes("s3")) scannerRuns.push(scanS3(awsConfig));
  if (plan.scanners.includes("sg")) scannerRuns.push(scanSecurityGroups(awsConfig));
  if (plan.scanners.includes("ec2")) scannerRuns.push(scanEc2(awsConfig));
  if (plan.scanners.includes("cost")) scannerRuns.push(scanCost(awsConfig));

  const results = await Promise.all(scannerRuns);
  let findings = dedupeFindings(results.flatMap((result) => result.findings));
  findings = filterFindings(findings, plan.filters);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const limitations = [...new Set(results.flatMap((result) => result.limitations))];
  const servicesAssessed = [...new Set(results.flatMap((result) => result.servicesAssessed))];
  const resourcesEvaluated = results.reduce((sum, result) => sum + result.resourcesEvaluated, 0);
  const severityCounts = findings.reduce<Record<UnifiedAuditSeverity, number>>((acc, finding) => {
    acc[finding.severity] += 1;
    return acc;
  }, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });

  const overallRisk: UnifiedAuditSeverity =
    severityCounts.CRITICAL > 0 ? "CRITICAL" :
    severityCounts.HIGH > 0 ? "HIGH" :
    severityCounts.MEDIUM > 0 ? "MEDIUM" :
    severityCounts.LOW > 0 ? "LOW" :
    "INFO";

  return {
    planner: plan,
    totals: {
      findings: findings.length,
      resourcesEvaluated,
      servicesAssessed: servicesAssessed.length,
      severityCounts,
      overallRisk,
    },
    servicesAssessed,
    limitations,
    findings,
    findingsForPanel: findings.slice(0, 25).map((finding) => ({
      id: finding.id,
      severity: normalizeSeverityForUi(finding.severity),
      title: finding.title,
      resource: finding.resource,
      timestamp: finding.timestamp,
      fixPrompt: finding.fix_prompt,
    })),
    synthesisInstructions: {
      style: "formal",
      useEmojis: false,
      sections: [
        "Executive Summary",
        "Top Three Issues",
        "Recommended Fix Order",
        "Patterns and Observations",
      ],
    },
  };
}

const UNIFIED_AUDIT_CACHE_TTL_MS = 5 * 60 * 1000;
type UnifiedAuditResult = Awaited<ReturnType<typeof runUnifiedAuditFresh>>;

function buildUnifiedAuditCacheKey(accountId: string, plan: UnifiedAuditPlan): string {
  const scanners = [...plan.scanners].sort().join(",");
  const filters = Object.entries(plan.filters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(",");
  return `scan:${accountId}:${plan.intent}:${scanners}:${filters}:${plan.scope}`;
}

async function runUnifiedAudit(rawQuery: string, awsConfig: any, supabaseAdmin: any, userId: string | null) {
  const plan = planUnifiedAudit(rawQuery);
  const sts = v2Client("STS", awsConfig);
  const identity = await withAwsRetry("STS.getCallerIdentity", () => sts.getCallerIdentity().promise());
  const accountId = identity.Account || "unknown-account";
  const cacheKey = buildUnifiedAuditCacheKey(accountId, plan);
  const nowIso = new Date().toISOString();

  const { data: cached, error: cacheReadError } = await supabaseAdmin
    .from("unified_audit_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (cacheReadError) {
    throw new CloudPilotError(`Failed to read unified audit cache: ${cacheReadError.message}`, {
      code: "UNIFIED_AUDIT_CACHE_READ_FAILED",
      category: "internal",
    });
  }

  if (cached?.response) {
    const cachedData = cached.response as UnifiedAuditResult;
    return {
      ...cachedData,
      cache: {
        status: "cached",
        lastRefreshedAt: cached.last_refreshed_at,
        ttlSeconds: Math.max(0, Math.floor((new Date(cached.expires_at).getTime() - Date.now()) / 1000)),
      },
      accountHealthScore: calculateAccountHealthScore(cachedData.totals.severityCounts),
    };
  }

  const freshData = await runUnifiedAuditFresh(rawQuery, awsConfig);
  const lastRefreshedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + UNIFIED_AUDIT_CACHE_TTL_MS).toISOString();

  const { error: cacheWriteError } = await supabaseAdmin.from("unified_audit_cache").upsert({
    user_id: userId,
    account_id: accountId,
    cache_key: cacheKey,
    planner: plan,
    response: freshData,
    last_refreshed_at: lastRefreshedAt,
    expires_at: expiresAt,
    updated_at: lastRefreshedAt,
  }, {
    onConflict: "cache_key",
  });

  if (cacheWriteError) {
    throw new CloudPilotError(`Failed to persist unified audit cache: ${cacheWriteError.message}`, {
      code: "UNIFIED_AUDIT_CACHE_WRITE_FAILED",
      category: "internal",
    });
  }

  return {
    ...freshData,
    cache: {
      status: "fresh",
      lastRefreshedAt,
      ttlSeconds: Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
    },
    accountHealthScore: calculateAccountHealthScore(freshData.totals.severityCounts),
  };
}


// ── CloudWatch Logs + WORM S3 Object Lock Audit Trail ───────────────────────
const CW_LOG_GROUP = "/cloudpilot/agent-audit";
const WORM_BUCKET_PREFIX = "cloudpilot-audit-worm-";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pushAuditToAws(awsConfig: any, payload: Record<string, any>) {
  try {
    // ── 1. CloudWatch Logs ──────────────────────────────────────────────────
    const groupName = CW_LOG_GROUP;
    const streamName = `agent-${new Date().toISOString().slice(0, 10)}`;

    // Ensure log group exists (idempotent)
    try {
      await v3Send("CloudWatchLogs", "CreateLogGroupCommand", awsConfig, { logGroupName: groupName });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.name !== "ResourceAlreadyExistsException" && e.code !== "ResourceAlreadyExistsException") throw e;
    }

    // Ensure log stream exists (idempotent)
    try {
      await v3Send("CloudWatchLogs", "CreateLogStreamCommand", awsConfig, { logGroupName: groupName, logStreamName: streamName });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.name !== "ResourceAlreadyExistsException" && e.code !== "ResourceAlreadyExistsException") throw e;
    }

    // Get the upload sequence token
    const desc = await v3Send("CloudWatchLogs", "DescribeLogStreamsCommand", awsConfig, {
      logGroupName: groupName,
      logStreamNamePrefix: streamName,
      limit: 1,
    });
    const seqToken = desc.logStreams?.[0]?.uploadSequenceToken;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cwParams: any = {
      logGroupName: groupName,
      logStreamName: streamName,
      logEvents: [{
        timestamp: Date.now(),
        message: JSON.stringify(payload),
      }],
    };
    if (seqToken) cwParams.sequenceToken = seqToken;

    await v3Send("CloudWatchLogs", "PutLogEventsCommand", awsConfig, cwParams);

    // ── 2. WORM S3 (Object Lock — Compliance Mode) ──────────────────────────
    const identity = await v3Send("STS", "GetCallerIdentityCommand", awsConfig, {});
    const accountId = identity.Account;
    const wormBucket = `${WORM_BUCKET_PREFIX}${accountId}`;

    // Ensure bucket exists with Object Lock enabled (must be set at creation)
    try {
      await v3Send("S3", "CreateBucketCommand", awsConfig, {
        Bucket: wormBucket,
        ObjectLockEnabledForBucket: true,
      });

      // Set default retention — 1 year Compliance mode (immutable)
      await v3Send("S3", "PutObjectLockConfigurationCommand", awsConfig, {
        Bucket: wormBucket,
        ObjectLockConfiguration: {
          ObjectLockEnabled: "Enabled",
          Rule: {
            DefaultRetention: {
              Mode: "COMPLIANCE",
              Days: 365,
            },
          },
        },
      });

      // Block all public access
      await v3Send("S3", "PutPublicAccessBlockCommand", awsConfig, {
        Bucket: wormBucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      });

      // Enable AES-256 encryption
      await v3Send("S3", "PutBucketEncryptionCommand", awsConfig, {
        Bucket: wormBucket,
        ServerSideEncryptionConfiguration: {
          Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
        },
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // BucketAlreadyOwnedByYou or BucketAlreadyExists means it's already set up
      if (e.name !== "BucketAlreadyOwnedByYou" && e.name !== "BucketAlreadyExists" && e.code !== "BucketAlreadyOwnedByYou" && e.code !== "BucketAlreadyExists") {
        console.error("[CloudPilot] WORM bucket setup error (non-fatal):", e.name || e.code);
      }
    }

    // Write the audit entry — Object Lock retention applies automatically
    const ts = payload.timestamp || new Date().toISOString();
    const logKey = `audit/${ts.slice(0, 10)}/${ts.replace(/:/g, "-")}-${crypto.randomUUID()}.json`;

    await v3Send("S3", "PutObjectCommand", awsConfig, {
      Bucket: wormBucket,
      Key: logKey,
      Body: JSON.stringify(payload, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // Audit failures are non-fatal — log but don't break the agent flow
    console.error("[CloudPilot] Audit push failed (CW/WORM):", e.name || e.code || e.message);
  }

}


// ── Security: Input validation ──────────────────────────────────────────────
const AWS_V3_SERVICE_MAP: Record<string, string> = {
  "S3": "s3",
  "EC2": "ec2",
  "IAM": "iam",
  "STS": "sts",
  "GuardDuty": "guardduty",
  "SecurityHub": "securityhub",
  "CloudTrail": "cloudtrail",
  "Config": "config-service",
  "RDS": "rds",
  "Lambda": "lambda",
  "EKS": "eks",
  "ECS": "ecs",
  "KMS": "kms",
  "SecretsManager": "secrets-manager",
  "SSM": "ssm",
  "Organizations": "organizations",
  "WAFv2": "wafv2",
  "CloudFront": "cloudfront",
  "SNS": "sns",
  "SQS": "sqs",
  "ECR": "ecr",
  "Athena": "athena",
  "CloudWatch": "cloudwatch",
  "CloudWatchLogs": "cloudwatch-logs",
  "Inspector2": "inspector2",
  "AccessAnalyzer": "accessanalyzer",
  "Macie2": "macie2",
  "NetworkFirewall": "network-firewall",
  "Shield": "shield",
  "ACM": "acm",
  "APIGateway": "api-gateway",
  "CognitoIdentityServiceProvider": "cognito-identity-provider",
  "EventBridge": "eventbridge",
  "StepFunctions": "sfn",
  "ElastiCache": "elasticache",
  "Redshift": "redshift",
  "DynamoDB": "dynamodb",
  "Route53": "route53",
  "ELBv2": "elastic-load-balancing-v2",
  "ElasticLoadBalancingV2": "elastic-load-balancing-v2",
  "ElasticLoadBalancing": "elastic-load-balancing",
  "AutoScaling": "auto-scaling",
  "ConfigService": "config-service",
  "SES": "ses",
  "ApiGateway": "api-gateway",
  "WAFV2": "wafv2",
  "CostExplorer": "cost-explorer",
  "Budgets": "budgets",
};

const ALLOWED_AWS_SERVICES = new Set(Object.keys(AWS_V3_SERVICE_MAP));

const BLOCKED_OPERATIONS = new Set([
  // Prevent destructive billing/account-level operations
  "closeAccount", "leaveOrganization", "deleteOrganization",
  "createAccount", "inviteAccountToOrganization",

  // Prevent AI from accidentally executing destructive resource deletions
  "terminateInstances", "deleteBucket", "deleteDbInstance",
  "deleteTable", "deleteCluster", "deleteFunction",
  "deleteVpc", "deleteSubnet", "deleteNatGateway",
  "deleteInternetGateway", "deleteRouteTable", "deleteSecurityGroup",
  "deleteKey", "scheduleKeyDeletion", "deleteSecret"
]);

// ── Privilege Escalation Validator ──────────────────────────────────────────
// Blocks operations that could escalate IAM privileges or compromise account security
const PRIVILEGE_ESCALATION_PATTERNS: Array<{ service: string; operations: Set<string>; reason: string }> = [
  {
    service: "IAM",
    operations: new Set([
      "createUser", "createLoginProfile", "updateLoginProfile",
      "createAccessKey", "putUserPolicy", "attachUserPolicy",
      "putGroupPolicy", "attachGroupPolicy",
      "putRolePolicy", "attachRolePolicy",
      "createPolicyVersion", "setDefaultPolicyVersion",
      "addUserToGroup", "updateAssumeRolePolicy",
      "createServiceLinkedRole",
    ]),
    reason: "This operation can escalate IAM privileges. It could grant broader access than the original credentials possess.",
  },
  {
    service: "STS",
    operations: new Set([
      "assumeRole",
    ]),
    reason: "Assuming a different role could escalate privileges beyond the current session scope.",
  },
  {
    service: "Organizations",
    operations: new Set([
      "createPolicy", "attachPolicy", "updatePolicy",
    ]),
    reason: "Organization-level policy changes can affect all accounts in the organization.",
  },
  {
    service: "Lambda",
    operations: new Set([
      "createFunction", "updateFunctionCode", "addPermission",
    ]),
    reason: "Lambda function creation/modification with an execution role could be used for privilege escalation.",
  },
];

interface ValidatorResult {
  allowed: boolean;
  reason?: string;
  riskLevel?: "BLOCKED" | "HIGH_RISK" | "ALLOWED";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validatePrivilegeEscalation(service: string, operation: string, params: any): ValidatorResult {
  // Check blocked operations first
  if (BLOCKED_OPERATIONS.has(operation)) {
    return {
      allowed: false,
      reason: `Operation '${operation}' is permanently blocked. This operation could cause irreversible account-level damage.`,
      riskLevel: "BLOCKED",
    };
  }

  // Check privilege escalation patterns
  for (const pattern of PRIVILEGE_ESCALATION_PATTERNS) {
    if (pattern.service === service && pattern.operations.has(operation)) {
      // Allow read-like operations that contain these words but are actually safe
      // e.g., "getPolicy" vs "putPolicy"
      const isReadOnly = /^(get|list|describe|head)/.test(operation);
      if (isReadOnly) {
        return { allowed: true, riskLevel: "ALLOWED" };
      }

      // For attack simulations, we allow but flag as HIGH_RISK and log extensively
      // The agent's system prompt mandates cleanup of simulation resources
      return {
        allowed: true,
        reason: `HIGH-RISK OPERATION: ${service}.${operation} — ${pattern.reason} This call is permitted for authorized security assessments but will be logged to the audit trail.`,
        riskLevel: "HIGH_RISK",
      };
    }
  }

  return { allowed: true, riskLevel: "ALLOWED" };
}

const MAX_MESSAGE_LENGTH = 50000;
const MAX_MESSAGES = 100;

const AWS_REGION_REGEX = /^[a-z]{2}(-[a-z]+-\d+)?$/;

const ACCESS_KEY_REGEX = /^[A-Z0-9]{16,128}$/;

const ROLE_ARN_REGEX = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

function sanitizeString(val: unknown, maxLen: number): string {
  if (typeof val !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return val.slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}


const ipRequestCounts = new Map<string, { count: number; expiresAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 20;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);
  if (!record || record.expiresAt < now) {
    ipRequestCounts.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  record.count++;
  return true;
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIp)) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const { toolCalls, awsConfig, userId, conversationId, notificationEmail, userHasConfirmedMutation, latestUserMessage } = body;
    const supabaseAdmin = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey);
    const apiMessages: any[] = [];
    let latestUnifiedAuditSummary: Record<string, any> | null = null;

    for (const toolCall of toolCalls) {
          if (toolCall.function.name === "manage_cost_rule") {
            const startTime = Date.now();
            try {
              if (!userId) {
                throw new Error("Authentication is required to store cost automation rules.");
              }

              const rawArgs = JSON.parse(toolCall.function.arguments);
              const rawQuery = sanitizeString(rawArgs.rawQuery, 2000);
              if (!rawQuery) {
                throw new Error("A raw cost rule query is required.");
              }

              const rule = parseCostRuleFromQuery(rawQuery, notificationEmail || null);
              await saveCostRule(supabaseAdmin, userId, rule);
              const execTime = Date.now() - startTime;

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "COST",
                  aws_operation: "manageCostRule",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  status: "stored",
                  rule,
                }),
              } as any);
            } catch (err: any) {
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: err?.message || "Cost rule creation failed." }),
              } as any);
            }
          }

          if (toolCall.function.name === "run_cost_anomaly_scan") {
            const startTime = Date.now();
            try {
              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const daysBack = Number(rawArgs.daysBack || 14);
              const rules = userId ? await fetchCostRules(supabaseAdmin, userId) : [];
              const costData = await fetchCostData(awsConfig, daysBack);
              const anomalies = detectCostAnomalies(costData.daily_by_service, rules);
              const idleInstances = await findIdleEc2Instances(awsConfig);
              const remediations = classifyCostRemediations(anomalies, idleInstances);
              const execTime = Date.now() - startTime;

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "COST",
                  aws_operation: "runCostAnomalyScan",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  period: costData.period,
                  ruleCount: rules.length,
                  rules,
                  anomalies,
                  idleInstances,
                  remediations,
                  freshness: {
                    status: "fresh",
                    generatedAt: new Date().toISOString(),
                  },
                }),
              } as any);
            } catch (err: any) {
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: err?.message || "Cost anomaly scan failed." }),
              } as any);
            }
          }

          if (toolCall.function.name === "manage_drift_baseline") {
            const startTime = Date.now();
            try {
              if (!userId) {
                throw new Error("Authentication is required for drift baseline management.");
              }

              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const action = sanitizeString(rawArgs.action, 64) as "capture_baseline" | "acknowledge_drift";

              if (action === "capture_baseline") {
                const scope = (sanitizeString(rawArgs.scope || "full", 64) || "full") as DriftScope;
                const accountId = await getAwsAccountId(awsConfig);
                const snapshots = await captureSnapshotsForScope(scope, awsConfig, accountId);
                await upsertBaselineSnapshots(supabaseAdmin, userId, snapshots);
                const execTime = Date.now() - startTime;

                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "MULTI",
                    aws_operation: "captureDriftBaseline",
                    aws_region: awsConfig.region,
                    status: "success",
                    validator_result: "ALLOWED",
                    execution_time_ms: execTime,
                  }).then();
                }

                pushAuditToAws(awsConfig, {
                  timestamp: new Date().toISOString(),
                  userId,
                  service: "MULTI",
                  operation: "captureDriftBaseline",
                  region: awsConfig.region,
                  status: "success",
                  scope,
                  snapshotCount: snapshots.length,
                  executionTimeMs: execTime,
                });

                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    status: "baseline_captured",
                    scope,
                    accountId,
                    snapshotCount: snapshots.length,
                    capturedAt: new Date().toISOString(),
                  }),
                } as any);
                continue;
              }

              if (action === "acknowledge_drift") {
                const driftEventId = sanitizeString(rawArgs.driftEventId, 128);
                if (!driftEventId) {
                  throw new Error("A drift event ID is required to acknowledge drift.");
                }

                const acknowledgement = await acknowledgeDriftEvent(supabaseAdmin, userId, driftEventId);
                const execTime = Date.now() - startTime;

                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "MULTI",
                    aws_operation: "acknowledgeDriftEvent",
                    aws_region: awsConfig.region,
                    status: "success",
                    validator_result: "ALLOWED",
                    execution_time_ms: execTime,
                  }).then();
                }

                pushAuditToAws(awsConfig, {
                  timestamp: new Date().toISOString(),
                  userId,
                  service: "MULTI",
                  operation: "acknowledgeDriftEvent",
                  region: awsConfig.region,
                  status: "success",
                  driftEventId,
                  resourceId: acknowledgement.resourceId,
                  resourceType: acknowledgement.resourceType,
                  executionTimeMs: execTime,
                });

                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    status: "acknowledged",
                    ...acknowledgement,
                    message: "The drift event has been resolved and the baseline has been updated to the current state.",
                  }),
                } as any);
                continue;
              }

              throw new Error(`Unsupported drift baseline action '${action}'.`);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const errorMessage = err?.message || "Drift baseline management failed.";

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "manageDriftBaseline",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: err?.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "MULTI",
                operation: "manageDriftBaseline",
                region: awsConfig.region,
                status: "error",
                errorCode: err?.code || null,
                errorMessage: errorMessage.slice(0, 2000),
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMessage }),
              } as any);
            }
          }

          if (toolCall.function.name === "run_drift_detection") {
            const startTime = Date.now();
            try {
              if (!userId) {
                throw new Error("Authentication is required for drift detection.");
              }

              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const rawQuery = sanitizeString(rawArgs.rawQuery, 2000);
              if (!rawQuery) {
                throw new Error("A raw drift query is required.");
              }

              const driftResult = await runDriftDetection(supabaseAdmin, userId, rawQuery, awsConfig);
              const execTime = Date.now() - startTime;

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "runDriftDetection",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "MULTI",
                operation: "runDriftDetection",
                region: awsConfig.region,
                status: "success",
                scope: driftResult.scope,
                driftCount: driftResult.driftCount,
                healthScore: driftResult.healthScore,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(driftResult),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const errorMessage = err?.message || "Drift detection failed.";

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "runDriftDetection",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: err?.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "MULTI",
                operation: "runDriftDetection",
                region: awsConfig.region,
                status: "error",
                errorCode: err?.code || null,
                errorMessage: errorMessage.slice(0, 2000),
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMessage }),
              } as any);
            }
          }

          if (toolCall.function.name === "run_unified_audit") {
            const startTime = Date.now();
            try {
              const rawArgs = JSON.parse(toolCall.function.arguments);
              const rawQuery = sanitizeString(rawArgs.rawQuery, 2000);
              if (!rawQuery) {
                throw new Error("A raw audit query is required.");
              }

              const auditResult = await runUnifiedAudit(rawQuery, awsConfig, supabaseAdmin, userId);
              const execTime = Date.now() - startTime;
              latestUnifiedAuditSummary = {
                planner: auditResult.planner,
                totals: auditResult.totals,
                cache: auditResult.cache,
                accountHealthScore: auditResult.accountHealthScore,
                findingsForPanel: auditResult.findingsForPanel,
                servicesAssessed: auditResult.servicesAssessed,
              };

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "runUnifiedAudit",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "MULTI",
                operation: "runUnifiedAudit",
                region: awsConfig.region,
                status: "success",
                intent: auditResult.planner.intent,
                scanners: auditResult.planner.scanners,
                findings: auditResult.totals.findings,
                overallRisk: auditResult.totals.overallRisk,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(auditResult),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const typedError = toCloudPilotError(err);
              let errorMessage = typedError.message || "Unified audit failed.";

              if (err.name === "AccessDeniedException" || err.name === "AccessDenied" || err.code === "AccessDeniedException" || err.code === "AccessDenied" || err.code === "UnauthorizedAccess" || err.code === "AuthorizationError" || err.$metadata?.httpStatusCode === 403 || err.statusCode === 403) {
                 errorMessage += "\n\nPlease ensure that CloudPilot AI has the necessary permissions to execute `run_unified_audit`. Required IAM permissions: `iam:ListUsers`, `iam:ListAttachedUserPolicies`, `iam:ListMFADevices`, `iam:ListAccessKeys`, `s3:ListAllMyBuckets`, `s3:GetBucketTagging`, `s3:GetBucketPublicAccessBlock`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetLifecycleConfiguration`, `ec2:DescribeSecurityGroups`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ce:GetCostAndUsage`, `sts:GetCallerIdentity`.";
              }

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "runUnifiedAudit",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: typedError.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "MULTI",
                operation: "runUnifiedAudit",
                region: awsConfig.region,
                status: "error",
                errorCode: typedError.code || null,
                errorMessage: errorMessage.slice(0, 2000),
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error: errorMessage,
                  code: typedError.code,
                  category: typedError.category,
                  retryable: typedError.retryable,
                }),
              } as any);
            }
          }

          if (toolCall.function.name === "execute_aws_api") {
            const startTime = Date.now();
            let service = "";
            let operation = "";
            let validatorResult: ValidatorResult = { allowed: true, riskLevel: "ALLOWED" };

            try {
              const args = JSON.parse(toolCall.function.arguments);
              service = sanitizeString(args.service, 64);
              operation = sanitizeString(args.operation, 128);

              // Security: validate service allowlist
              if (!ALLOWED_AWS_SERVICES.has(service)) {
                throw new Error(`AWS service '${service}' is not allowed. Permitted services: ${[...ALLOWED_AWS_SERVICES].join(", ")}`);
              }

              // ── Privilege Escalation Validator ──────────────────────────────
              validatorResult = validatePrivilegeEscalation(service, operation, args.params);
              if (!validatorResult.allowed) {
                // Log blocked call to audit
                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: service,
                    aws_operation: operation,
                    aws_region: awsConfig.region,
                    params_hash: args.params ? btoa(JSON.stringify(args.params).slice(0, 200)) : null,
                    status: "blocked",
                    error_message: validatorResult.reason,
                    validator_result: validatorResult.riskLevel,
                    execution_time_ms: Date.now() - startTime,
                  }).then();
                }
                throw new Error(validatorResult.reason);
              }

              console.log(`[CloudPilot] AWS API: ${service}.${operation} [${validatorResult.riskLevel}]`, JSON.stringify(args.params ?? {}));

              // Use aws-executor proxy for the SDK call
              const commandName = `${operation.charAt(0).toUpperCase() + operation.slice(1)}Command`;

              const result = await withAwsRetry(`${service}.${operation}`, () =>
                awsExec(service, commandName, awsConfig, args.params || {})
              );
              const execTime = Date.now() - startTime;
              const resultData = result ?? {};

              // Truncate very large responses to prevent context overflow
              let resultStr: string;
              try {
                resultStr = JSON.stringify(resultData) ?? "{}";
              } catch {
                resultStr = "{}";
              }
              if (resultStr && resultStr.length > 100000) {
                resultStr = resultStr.slice(0, 100000) + '... [TRUNCATED — response too large, narrow your query]';
              }

              // ── Audit log: successful call ──────────────────────────────────
              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: service,
                  aws_operation: operation,
                  aws_region: awsConfig.region,
                  params_hash: args.params ? btoa(JSON.stringify(args.params).slice(0, 200)) : null,
                  status: "success",
                  validator_result: validatorResult.riskLevel,
                  execution_time_ms: execTime,
                }).then();
              }

              // ── CloudWatch Logs + WORM S3 Audit Trail (User's Account) ──────────
              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service,
                operation,
                region: awsConfig.region,
                params: args.params,
                status: "success",
                validatorResult: validatorResult.riskLevel,
                executionTimeMs: execTime,
              });

              // Prepend validator warning to tool response if HIGH_RISK
              const prefix = validatorResult.riskLevel === "HIGH_RISK"
                ? `[VALIDATOR WARNING: ${validatorResult.reason}]\n\n`
                : "";

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: prefix + resultStr,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const typedError = toCloudPilotError(err);
              console.error("[CloudPilot] AWS SDK Error:", typedError.message);

              let errorDetail = typedError.message;
              if (err.name === "AccessDeniedException" || err.name === "AccessDenied" || err.code === "AccessDeniedException" || err.code === "AccessDenied" || err.code === "UnauthorizedAccess" || err.code === "AuthorizationError" || err.$metadata?.httpStatusCode === 403 || err.statusCode === 403) {
                const svc = service.toLowerCase();
                const op = operation;
                errorDetail = `PERMISSION DENIED: The configured IAM credentials do not have permission to perform '${svc}:${op}'. ` +
                  `To resolve this, the IAM user/role needs the following permission added to its policy:\n\n` +
                  `{\n  "Effect": "Allow",\n  "Action": "${svc}:${op[0].toUpperCase() + op.slice(1)}",\n  "Resource": "*"\n}\n\n` +
                  `Original error: ${err.message} (Code: ${err.name || err.code})`;
              }

              // ── Audit log: failed call ──────────────────────────────────────
              if (userId && service) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: service || "UNKNOWN",
                  aws_operation: operation || "UNKNOWN",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: typedError.code || null,
                  error_message: (errorDetail || "").slice(0, 2000),
                  validator_result: validatorResult.riskLevel,
                  execution_time_ms: execTime,
                }).then();
              }

              // ── CloudWatch Logs + WORM S3 Audit Trail (Error) ─────────────
              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: service || "UNKNOWN",
                operation: operation || "UNKNOWN",
                region: awsConfig.region,
                status: "error",
                errorCode: typedError.code || null,
                errorMessage: (errorDetail || "").slice(0, 2000),
                validatorResult: validatorResult.riskLevel,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error: errorDetail,
                  code: typedError.code,
                  category: typedError.category,
                  retryable: typedError.retryable,
                  statusCode: err.$metadata?.httpStatusCode || err.statusCode || typedError.status,
                }),
              } as any);
            }
          }

    }

    const results = apiMessages
      .filter((m: any) => m.role === "tool")
      .map((m: any) => ({
        toolCallId: m.tool_call_id,
        content: m.content,
        auditSummary: latestUnifiedAuditSummary || undefined,
      }));
    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[Scanner] Fatal error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

if (import.meta.main) {
  serve(handler);
}
