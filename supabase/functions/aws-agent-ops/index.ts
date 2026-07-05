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
  const resp = await fetch(EXECUTOR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
      apikey: ENV.supabaseServiceRoleKey,
    },
    body: JSON.stringify({ service, commandName, config, params }),
  });
  const data = await resp.json();
  if (data.error) {
    const err: any = new Error(data.error);
    err.name = data.name || "Error";
    err.code = data.code || "UNKNOWN";
    err.$metadata = { httpStatusCode: data.statusCode || 500 };
    err.statusCode = data.statusCode || 500;
    throw err;
  }
  return data.result;
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

async function upsertApprovalRequest(
  supabaseAdmin: any,
  payload: {
    requestKey: string;
    requestHash: string;
    operationName: string;
    requesterUserId: string;
    summary: string;
    riskLevel: string;
    requiredApprovals: number;
    previewPayload: Record<string, unknown>;
    requestPayload: Record<string, unknown>;
    evidencePayload?: Record<string, unknown>;
  },
) {
  const dualApprovalRequired = payload.requiredApprovals > 1;
  const baseRow = {
    request_key: payload.requestKey,
    request_hash: payload.requestHash,
    operation_name: payload.operationName,
    requester_user_id: payload.requesterUserId,
    summary: payload.summary,
    risk_level: payload.riskLevel,
    required_approvals: payload.requiredApprovals,
    dual_approval_required: dualApprovalRequired,
    preview_payload: payload.previewPayload,
    request_payload: payload.requestPayload,
    evidence_payload: payload.evidencePayload || {},
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("approval_requests")
    .select("*")
    .eq("request_key", payload.requestKey)
    .maybeSingle();

  if (fetchError) {
    throw new CloudPilotError(`Failed to read approval request: ${fetchError.message}`, {
      code: "APPROVAL_REQUEST_LOOKUP_FAILED",
      category: "internal",
    });
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("approval_requests")
      .update(baseRow)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) {
      throw new CloudPilotError(`Failed to update approval request: ${updateError.message}`, {
        code: "APPROVAL_REQUEST_UPDATE_FAILED",
        category: "internal",
      });
    }

    return updated;
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from("approval_requests")
    .insert({
      ...baseRow,
      status: "pending_approval",
    })
    .select("*")
    .single();

  if (insertError) {
    throw new CloudPilotError(`Failed to create approval request: ${insertError.message}`, {
      code: "APPROVAL_REQUEST_INSERT_FAILED",
      category: "internal",
    });
  }

  return created;
}

async function recordApprovalAction(
  supabaseAdmin: any,
  approvalRequestId: string,
  approverUserId: string,
  decision = "approve",
  comment?: string,
) {
  const { error } = await supabaseAdmin
    .from("approval_actions")
    .upsert({
      approval_request_id: approvalRequestId,
      approver_user_id: approverUserId,
      decision,
      comment: comment || null,
    }, {
      onConflict: "approval_request_id,approver_user_id",
    });

  if (error) {
    throw new CloudPilotError(`Failed to record approval action: ${error.message}`, {
      code: "APPROVAL_ACTION_INSERT_FAILED",
      category: "internal",
    });
  }
}

async function refreshApprovalRequestState(
  supabaseAdmin: any,
  approvalRequestId: string,
  requiredApprovals: number,
  nextStatusIfSatisfied = "approved",
) {
  const { data: actions, error: actionsError } = await supabaseAdmin
    .from("approval_actions")
    .select("approver_user_id, decision")
    .eq("approval_request_id", approvalRequestId);

  if (actionsError) {
    throw new CloudPilotError(`Failed to read approval actions: ${actionsError.message}`, {
      code: "APPROVAL_ACTION_LOOKUP_FAILED",
      category: "internal",
    });
  }

  const approverIds = Array.from(new Set(
    (actions || [])
      .filter((action: any) => action.decision === "approve")
      .map((action: any) => action.approver_user_id),
  ));

  const approvalCount = approverIds.length;
  const status = approvalCount >= requiredApprovals ? nextStatusIfSatisfied : "pending_approval";

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("approval_requests")
    .update({
      current_approvals: approvalCount,
      status,
      last_approved_at: approvalCount > 0 ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", approvalRequestId)
    .select("*")
    .single();

  if (updateError) {
    throw new CloudPilotError(`Failed to update approval counts: ${updateError.message}`, {
      code: "APPROVAL_REQUEST_STATE_UPDATE_FAILED",
      category: "internal",
    });
  }

  return {
    request: updated,
    approvalCount,
    approverIds,
    status,
  };
}

async function markApprovalRequestExecuted(
  supabaseAdmin: any,
  approvalRequestId: string,
  executionPayload: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin
    .from("approval_requests")
    .update({
      status: "executed",
      execution_payload: executionPayload,
      executed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", approvalRequestId);

  if (error) {
    console.error("Failed to mark approval request as executed:", error.message);
  }
}

async function markApprovalRequestFailed(
  supabaseAdmin: any,
  approvalRequestId: string,
  errorPayload: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin
    .from("approval_requests")
    .update({
      status: "failed",
      execution_payload: errorPayload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", approvalRequestId);

  if (error) {
    console.error("Failed to mark approval request as failed:", error.message);
  }
}

function buildApprovalSummaryPayload(
  approvalRequest: any,
  approvalCount: number,
  requiredApprovals: number,
  nextAction: string,
) {
  return {
    approvalRequestId: approvalRequest.id,
    requestKey: approvalRequest.request_key,
    status: approvalRequest.status,
    currentApprovals: approvalCount,
    requiredApprovals,
    dualApprovalRequired: requiredApprovals > 1,
    nextAction,
  };
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


type IamPrincipalType = "user" | "group" | "role";
type IamAutomationAction = "attach_policy";
type IamAutomationService = "s3";
type IamAutomationScope = "read-only";

interface IamAutomationArgs {
  action: IamAutomationAction;
  principalType: IamPrincipalType;
  principalIdentifier: string;
  service: IamAutomationService;
  scope: IamAutomationScope;
  resources?: string[];
}

interface IamPolicyTemplate {
  actions: string[];
  defaultResources: string[];
  warning?: string;
}

const IAM_POLICY_TEMPLATES: Record<string, IamPolicyTemplate> = {
  "s3:read-only": {
    actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
    defaultResources: ["arn:aws:s3:::*", "arn:aws:s3:::*/*"],
    warning: "Resource scope is broad (all buckets). Prefer specifying exact bucket ARNs when possible.",
  },
};

function isExplicitConfirmation(input: string): boolean {
  const text = sanitizeString(input, 200).trim();
  return IAM_CONFIRM_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizePrincipalIdentifier(value: unknown): string {
  return sanitizeString(value, 128).replace(/[^\w+=,.@-]/g, "");
}

function sanitizeArnList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => sanitizeString(value, 512).trim())
    .filter(Boolean)
    .slice(0, 25);
}

function buildPolicyName(principalIdentifier: string, service: string, scope: string): string {
  const safePrincipal = principalIdentifier.toLowerCase().replace(/[^a-z0-9+=,.@-]/g, "-").slice(0, 48);
  const safeService = service.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const safeScope = scope.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `guardian-${safePrincipal}-${safeService}-${safeScope}-${Date.now()}`;
}

function validateIamPolicyActions(actions: string[]): { valid: boolean; reason?: string } {
  for (const action of actions) {
    if (IAM_BLOCKED_ACTIONS.has(action) || action.endsWith(":*")) {
      return {
        valid: false,
        reason: `Action '${action}' is blocked because it is too broad or creates an escalation path.`,
      };
    }
  }
  return { valid: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildIamAccessPlan(rawArgs: Record<string, any>) {
  const args: IamAutomationArgs = {
    action: rawArgs.action,
    principalType: rawArgs.principalType,
    principalIdentifier: sanitizePrincipalIdentifier(rawArgs.principalIdentifier),
    service: rawArgs.service,
    scope: rawArgs.scope,
    resources: sanitizeArnList(rawArgs.resources),
  };

  if (!args.principalIdentifier) {
    throw new Error("A valid IAM principal identifier is required.");
  }

  const template = IAM_POLICY_TEMPLATES[`${args.service}:${args.scope}`];
  if (!template) {
    throw new Error(`Unsupported IAM automation request: ${args.service}:${args.scope}.`);
  }

  const resources = args.resources && args.resources.length > 0
    ? args.resources
    : template.defaultResources;

  const actionValidation = validateIamPolicyActions(template.actions);
  if (!actionValidation.valid) {
    throw new Error(actionValidation.reason);
  }

  const policyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: template.actions,
        Resource: resources,
      },
    ],
  };

  const policyName = buildPolicyName(args.principalIdentifier, args.service, args.scope);
  const warnings: string[] = [];
  if (!args.resources || args.resources.length === 0) {
    warnings.push(template.warning || "Resource scope is broad.");
  }

  const attachOperation = args.principalType === "group"
    ? "attachGroupPolicy"
    : args.principalType === "role"
      ? "attachRolePolicy"
      : "attachUserPolicy";

  return {
    args,
    policyName,
    policyDocument,
    warnings,
    attachOperation,
  };
}

function requiredApprovalsForIamPlan(plan: ReturnType<typeof buildIamAccessPlan>): number {
  const principal = plan.args.principalIdentifier.toLowerCase();
  const resources = stableStringify(plan.policyDocument.Statement[0]?.Resource || "").toLowerCase();
  return principal.includes("prod") || resources.includes("prod") ? 2 : 1;
}

async function ensureIamPrincipalExists(iam: any, principalType: IamPrincipalType, identifier: string) {
  if (principalType === "group") {
    await iam.getGroup({ GroupName: identifier }).promise();
    return;
  }
  if (principalType === "role") {
    await iam.getRole({ RoleName: identifier }).promise();
    return;
  }
  await iam.getUser({ UserName: identifier }).promise();
}

type SecurityGroupAction = "allow_ingress" | "revoke_ingress" | "allow_egress" | "revoke_egress";

interface SecurityGroupRuleArgs {
  action: SecurityGroupAction;
  targetGroupIdentifier: string;
  protocol: "tcp" | "udp" | "icmp" | "-1";
  fromPort: number;
  toPort: number;
  cidr?: string;
  sourceGroupIdentifier?: string;
  description?: string;
}

interface SecurityGroupSummary {
  groupId: string;
  groupName: string;
  vpcId?: string;
  tags: Record<string, string>;
  ingressPermissions: any[];
  egressPermissions: any[];
}

interface SecurityGroupRiskResult {
  allowed: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
  reasons: string[];
}

const SENSITIVE_PORTS = new Set([22, 3389, 3306, 5432, 1433, 27017, 6379, 9200]);
const LOW_RISK_PORTS = new Set([80, 443, 53]);

function getSecurityGroupDirection(action: SecurityGroupAction): "ingress" | "egress" {
  return action.endsWith("egress") ? "egress" : "ingress";
}

function isAllowAction(action: SecurityGroupAction): boolean {
  return action.startsWith("allow_");
}

function isSecurityGroupId(value: string): boolean {
  return /^sg-[a-z0-9]+$/i.test(value);
}

function sanitizeSecurityGroupIdentifier(value: unknown): string {
  return sanitizeString(value, 128).replace(/[^\w+=,.@:-]/g, "");
}

function sanitizeCidr(value: unknown): string {
  return sanitizeString(value, 64).trim();
}

function sanitizeProtocol(value: unknown): "tcp" | "udp" | "icmp" | "-1" {
  const protocol = sanitizeString(value, 16).toLowerCase();
  if (protocol === "tcp" || protocol === "udp" || protocol === "icmp" || protocol === "-1") {
    return protocol;
  }
  throw new Error(`Unsupported protocol '${protocol}'.`);
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < -1 || port > 65535) {
    throw new Error(`Invalid port '${value}'.`);
  }
  return port;
}

function summarizeTags(tags: any[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags || []) {
    if (tag.Key && tag.Value) out[tag.Key.toLowerCase()] = tag.Value.toLowerCase();
  }
  return out;
}

function isBroadCidr(cidr?: string): boolean {
  return cidr === IPV4_ANYWHERE || cidr === IPV6_ANYWHERE;
}

function isProdLikeGroup(summary: SecurityGroupSummary): boolean {
  return (
    summary.groupName.toLowerCase().includes("prod") ||
    summary.tags.env === "prod" ||
    summary.tags.env === "production" ||
    summary.tags.environment === "prod" ||
    summary.tags.environment === "production" ||
    summary.tags.stage === "prod" ||
    summary.tags.stage === "production" ||
    summary.tags.tier === "prod" ||
    summary.tags.tier === "production" ||
    summary.tags.name?.includes("prod") === true
  );
}

function requiredApprovalsForSecurityGroup(targetGroup: SecurityGroupSummary): number {
  return isProdLikeGroup(targetGroup) ? 2 : 1;
}

function classifySecurityGroupRisk(
  targetGroup: SecurityGroupSummary,
  args: SecurityGroupRuleArgs,
  hasSourceGroup: boolean,
): SecurityGroupRiskResult {
  const reasons: string[] = [];
  const direction = getSecurityGroupDirection(args.action);
  const broad = isBroadCidr(args.cidr);
  const prodLike = isProdLikeGroup(targetGroup);
  const singlePort = args.fromPort === args.toPort ? args.fromPort : null;
  const allTraffic = args.protocol === "-1" || (args.fromPort === -1 && args.toPort === -1);

  if (args.action === "allow_ingress" && broad && (singlePort === 22 || singlePort === 3389)) {
    return {
      allowed: false,
      riskLevel: "BLOCKED",
      reasons: [`Opening port ${singlePort} to the internet is hard-blocked.`],
    };
  }

  if (direction === "ingress" && isAllowAction(args.action) && broad) {
    reasons.push("Rule exposes the security group to the public internet.");
  }
  if (direction === "egress" && isAllowAction(args.action) && broad) {
    reasons.push("Rule allows outbound internet access.");
  }
  if (singlePort !== null && SENSITIVE_PORTS.has(singlePort)) {
    reasons.push(`Port ${singlePort} is considered sensitive.`);
  }
  if (allTraffic) {
    reasons.push("Rule applies to all traffic.");
  }
  if (prodLike) {
    reasons.push("Target security group appears to be production-scoped.");
  }
  if (hasSourceGroup) {
    reasons.push("Rule is scoped to another security group instead of a public CIDR.");
  }

  if (!isAllowAction(args.action)) {
    return { allowed: true, riskLevel: "LOW", reasons: ["Revoking access is low risk."] };
  }

  if (direction === "ingress" && hasSourceGroup && singlePort !== null && LOW_RISK_PORTS.has(singlePort) && !prodLike) {
    return { allowed: true, riskLevel: "LOW", reasons };
  }

  if (direction === "egress" && allTraffic && broad && prodLike) {
    return { allowed: true, riskLevel: "HIGH", reasons };
  }

  if (broad || prodLike || allTraffic || (singlePort !== null && SENSITIVE_PORTS.has(singlePort))) {
    return {
      allowed: true,
      riskLevel: (broad && (prodLike || allTraffic || (singlePort !== null && SENSITIVE_PORTS.has(singlePort)))) || (prodLike && allTraffic)
        ? "HIGH"
        : "MEDIUM",
      reasons,
    };
  }

  return { allowed: true, riskLevel: "LOW", reasons: reasons.length > 0 ? reasons : ["Scoped security group rule."] };
}

async function resolveSecurityGroup(ec2: any, identifier: string): Promise<SecurityGroupSummary> {
  const params = isSecurityGroupId(identifier)
    ? { GroupIds: [identifier] }
    : { Filters: [{ Name: "group-name", Values: [identifier] }] };

  const response = await ec2.describeSecurityGroups(params).promise();
  const groups = response.SecurityGroups || [];
  if (groups.length === 0) {
    throw new Error(`Security group '${identifier}' was not found.`);
  }
  if (!isSecurityGroupId(identifier) && groups.length > 1) {
    throw new Error(`Security group name '${identifier}' is ambiguous. Use the security group ID instead.`);
  }

  const group = groups[0];
  if (!group.GroupId || !group.GroupName) {
    throw new Error(`Security group '${identifier}' is missing required metadata.`);
  }

  return {
    groupId: group.GroupId,
    groupName: group.GroupName,
    vpcId: group.VpcId,
    tags: summarizeTags(group.Tags),
    ingressPermissions: group.IpPermissions || [],
    egressPermissions: group.IpPermissionsEgress || [],
  };
}

function ipPermissionTargets(permission: any): string[] {
  const cidrs = (permission.IpRanges || []).map((range) => range.CidrIp).filter(Boolean) as string[];
  const ipv6Cidrs = (permission.Ipv6Ranges || []).map((range) => range.CidrIpv6).filter(Boolean) as string[];
  const groups = (permission.UserIdGroupPairs || []).map((pair) => pair.GroupId).filter(Boolean) as string[];
  return [...cidrs, ...ipv6Cidrs, ...groups];
}

function permissionMatchesRequested(
  existing: any,
  requested: any,
  args: SecurityGroupRuleArgs,
  sourceGroupId?: string,
): boolean {
  if ((existing.IpProtocol || "") !== requested.IpProtocol) return false;
  if ((existing.FromPort ?? -1) !== (requested.FromPort ?? -1)) return false;
  if ((existing.ToPort ?? -1) !== (requested.ToPort ?? -1)) return false;

  const existingTargets = new Set(ipPermissionTargets(existing));
  if (sourceGroupId) {
    return existingTargets.has(sourceGroupId);
  }
  if (args.cidr) {
    return existingTargets.has(args.cidr);
  }
  return false;
}

function findExistingMatchingPermission(
  targetGroup: SecurityGroupSummary,
  args: SecurityGroupRuleArgs,
  requestedPermission: any,
  sourceGroupId?: string,
): any | null {
  const permissions = getSecurityGroupDirection(args.action) === "egress"
    ? targetGroup.egressPermissions
    : targetGroup.ingressPermissions;

  for (const permission of permissions || []) {
    if (permissionMatchesRequested(permission, requestedPermission, args, sourceGroupId)) {
      return permission;
    }
  }
  return null;
}

function buildSecurityGroupOperationName(action: SecurityGroupAction): string {
  switch (action) {
    case "allow_ingress":
      return "authorizeSecurityGroupIngress";
    case "revoke_ingress":
      return "revokeSecurityGroupIngress";
    case "allow_egress":
      return "authorizeSecurityGroupEgress";
    case "revoke_egress":
      return "revokeSecurityGroupEgress";
  }
}

function calculateAccountHealthScore(counts: Record<UnifiedAuditSeverity, number>): number {
  const score =
    100 -
    counts.CRITICAL * 20 -
    counts.HIGH * 10 -
    counts.MEDIUM * 5 -
    counts.LOW * 2;
  return Math.max(0, score);
}


const ORG_CONFIRM_PATTERNS = [
  /^apply to (\d+) accounts?$/i,
  /^confirm apply to (\d+) accounts?$/i,
];

const ORG_EXTERNAL_ID = Deno.env.get("GUARDIAN_ORG_EXTERNAL_ID") || "";
const ORG_ROLE_NAME = Deno.env.get("GUARDIAN_EXECUTION_ROLE_NAME") || "GuardianExecutionRole";
const orgClientCache = new Map<string, { expiresAt: number; config: Record<string, any> }>();

const ENV_TIERS: Record<string, { confirmation: "single" | "double"; auto_execute: boolean; max_accounts: number; require_mfa: boolean; rollback_plan: "auto" | "manual" | "required" }> = {
  dev: {
    confirmation: "single",
    auto_execute: true,
    max_accounts: 50,
    require_mfa: false,
    rollback_plan: "auto",
  },
  staging: {
    confirmation: "single",
    auto_execute: false,
    max_accounts: 20,
    require_mfa: false,
    rollback_plan: "manual",
  },
  prod: {
    confirmation: "double",
    auto_execute: false,
    max_accounts: 5,
    require_mfa: true,
    rollback_plan: "required",
  },
  unknown: {
    confirmation: "double",
    auto_execute: false,
    max_accounts: 1,
    require_mfa: true,
    rollback_plan: "required",
  },
};

const SCP_TEMPLATES: Record<OrgScpTemplate, { description: string; build: (args: { allowedRegions?: string[] }) => Record<string, any> }> = {
  deny_non_approved_regions: {
    description: "Deny actions outside approved regions",
    build: ({ allowedRegions }) => {
      if (!allowedRegions || allowedRegions.length === 0) {
        throw new Error("allowedRegions is required for the deny_non_approved_regions template.");
      }
      return {
        Version: "2012-10-17",
        Statement: [{
          Sid: "DenyNonApprovedRegions",
          Effect: "Deny",
          Action: "*",
          Resource: "*",
          Condition: {
            StringNotEquals: {
              "aws:RequestedRegion": allowedRegions,
            },
          },
        }],
      };
    },
  },
  deny_root_account_usage: {
    description: "Deny actions performed by the root account",
    build: () => ({
      Version: "2012-10-17",
      Statement: [{
        Sid: "DenyRootUserActions",
        Effect: "Deny",
        Action: "*",
        Resource: "*",
        Condition: {
          StringLike: {
            "aws:PrincipalArn": "arn:aws:iam::*:root",
          },
        },
      }],
    }),
  },
  require_mfa_for_all_actions: {
    description: "Deny actions when MFA is not present",
    build: () => ({
      Version: "2012-10-17",
      Statement: [{
        Sid: "RequireMfaForAllActions",
        Effect: "Deny",
        Action: "*",
        Resource: "*",
        Condition: {
          BoolIfExists: {
            "aws:MultiFactorAuthPresent": "false",
          },
        },
      }],
    }),
  },
  deny_leaving_org: {
    description: "Prevent accounts from leaving the organization",
    build: () => ({
      Version: "2012-10-17",
      Statement: [{
        Sid: "DenyLeaveOrganization",
        Effect: "Deny",
        Action: "organizations:LeaveOrganization",
        Resource: "*",
      }],
    }),
  },
  enforce_s3_encryption: {
    description: "Deny S3 PutObject without server-side encryption",
    build: () => ({
      Version: "2012-10-17",
      Statement: [{
        Sid: "DenyUnencryptedObjectUploads",
        Effect: "Deny",
        Action: "s3:PutObject",
        Resource: "*",
        Condition: {
          Null: {
            "s3:x-amz-server-side-encryption": "true",
          },
        },
      }],
    }),
  },
};

const WATCHED_CLOUDTRAIL_EVENTS = new Set([
  "AuthorizeSecurityGroupIngress",
  "AuthorizeSecurityGroupEgress",
  "RevokeSecurityGroupIngress",
  "RevokeSecurityGroupEgress",
  "CreateSecurityGroup",
  "DeleteSecurityGroup",
  "DeleteBucketPublicAccessBlock",
  "PutBucketPublicAccessBlock",
  "PutBucketPolicy",
  "DeleteBucketPolicy",
  "DeleteBucketEncryption",
  "PutBucketEncryption",
  "PutBucketAcl",
  "AttachUserPolicy",
  "DetachUserPolicy",
  "AttachRolePolicy",
  "PutUserPolicy",
  "CreateUser",
  "DeleteUser",
  "CreateAccessKey",
  "DeleteAccessKey",
  "UpdateAccessKey",
  "DeactivateMFADevice",
  "CreateLoginProfile",
  "CreateVpc",
  "DeleteVpc",
  "CreateInternetGateway",
  "AttachInternetGateway",
  "CreateNatGateway",
  "RunInstances",
  "TerminateInstances",
  "StopInstances",
  "CreateAccount",
  "LeaveOrganization",
  "DisableAWSServiceAccess",
  "DeleteTrail",
  "StopLogging",
  "PutEventSelectors",
]);

const BUILT_IN_EVENT_RESPONSE_POLICIES: EventResponsePolicyRecord[] = [
  {
    id: "builtin-auto-block-public-s3",
    policy_id: "auto_block_public_s3",
    name: "Auto-block public S3 access",
    trigger_event: "DeleteBucketPublicAccessBlock",
    trigger_conditions: {},
    risk_threshold: "CRITICAL",
    response_type: "auto_fix",
    response_action: "put_public_access_block",
    response_params: { block_all: true },
    notify_channels: ["slack:#security"],
    raw_query: "If a public access block is removed from an S3 bucket, restore it immediately.",
    created_by: "guardian_builtin",
    is_active: true,
    built_in: true,
  },
  {
    id: "builtin-alert-new-iam-user",
    policy_id: "alert_new_iam_user",
    name: "Alert on new IAM user creation",
    trigger_event: "CreateUser",
    trigger_conditions: { actor_is_guardian: false },
    risk_threshold: "HIGH",
    response_type: "notify",
    response_action: "send_alert",
    response_params: { message: "New IAM user {resource_id} created by {actor_arn}" },
    notify_channels: ["slack:#security"],
    raw_query: "Alert the security team whenever a new IAM user is created outside Guardian.",
    created_by: "guardian_builtin",
    is_active: true,
    built_in: true,
  },
  {
    id: "builtin-restore-cloudtrail",
    policy_id: "restore_cloudtrail",
    name: "Restore CloudTrail if disabled",
    trigger_event: "DeleteTrail",
    trigger_conditions: {},
    risk_threshold: "CRITICAL",
    response_type: "all",
    response_action: "restore_cloudtrail_and_alert",
    response_params: { runbook: "cloudtrail_disabled_response" },
    notify_channels: ["slack:#security", "pagerduty"],
    raw_query: "If CloudTrail is disabled, restore it immediately and alert the security team.",
    created_by: "guardian_builtin",
    is_active: true,
    built_in: true,
  },
  {
    id: "builtin-flag-root-usage",
    policy_id: "flag_root_usage",
    name: "Alert on any root account usage",
    trigger_event: "*",
    trigger_conditions: { actor_type: "root" },
    risk_threshold: "CRITICAL",
    response_type: "all",
    response_action: "root_usage_response",
    response_params: { runbook: "root_account_usage_response" },
    notify_channels: ["slack:#security", "pagerduty"],
    raw_query: "If the root account is used for anything, alert immediately and start the root-account response workflow.",
    created_by: "guardian_builtin",
    is_active: true,
    built_in: true,
  },
];

function parseOrgConfirmationCount(input: string): number | null {
  const text = sanitizeString(input, 200).trim();
  for (const pattern of ORG_CONFIRM_PATTERNS) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

async function getAssumedAwsConfig(accountId: string, region: string, externalId?: string): Promise<Record<string, any>> {
  const cacheKey = `${accountId}:${region}`;
  const cached = orgClientCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.config;
  }

  const resolvedExternalId = externalId || ORG_EXTERNAL_ID;
  if (!resolvedExternalId) {
    throw new Error("GUARDIAN_ORG_EXTERNAL_ID is not configured for cross-account role assumption.");
  }

  const sts = v2Client("STS", { region });
  const roleArn = `arn:aws:iam::${accountId}:role/${ORG_ROLE_NAME}`;
  const assumed = await sts.assumeRole({
    RoleArn: roleArn,
    RoleSessionName: `guardian-${Date.now()}`,
    DurationSeconds: 3600,
    ExternalId: resolvedExternalId,
  }).promise();

  const credentials = assumed.Credentials;
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken || !credentials.Expiration) {
    throw new Error(`AssumeRole returned incomplete credentials for account ${accountId}.`);
  }

  const config: Record<string, any> = {
    region,
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
  };
  orgClientCache.set(cacheKey, {
    config,
    expiresAt: credentials.Expiration.getTime(),
  });
  return config;
}

async function getAccountTags(org: any, accountId: string): Promise<Record<string, string>> {
  const response = await org.listTagsForResource({ ResourceId: accountId }).promise();
  const tags: Record<string, string> = {};
  for (const tag of response.Tags || []) {
    if (tag.Key && tag.Value) {
      tags[tag.Key.toLowerCase()] = tag.Value.toLowerCase();
    }
  }
  return tags;
}

async function resolveParentPath(org: any, parentId: string): Promise<string> {
  if (parentId.startsWith("r-")) {
    return "/root";
  }
  const ou = await org.describeOrganizationalUnit({ OrganizationalUnitId: parentId }).promise();
  const name = ou.OrganizationalUnit?.Name || parentId;
  const parent = await org.listParents({ ChildId: parentId }).promise();
  const nextParentId = parent.Parents?.[0]?.Id;
  if (!nextParentId) return `/root/${name}`;
  const prefix = await resolveParentPath(org, nextParentId);
  return `${prefix}/${name}`;
}

async function getAccountOuPath(org: any, accountId: string): Promise<string> {
  const parents = await org.listParents({ ChildId: accountId }).promise();
  const parentId = parents.Parents?.[0]?.Id;
  if (!parentId) return "/root";
  return resolveParentPath(org, parentId);
}

async function listOrgAccounts(awsConfig: any): Promise<OrgAccountSummary[]> {
  const org = v2Client("Organizations", awsConfig);
  const accounts: OrgAccountSummary[] = [];
  let nextToken: string | undefined;

  do {
    const page = await org.listAccounts({ NextToken: nextToken }).promise();
    for (const acct of page.Accounts || []) {
      if (!acct.Id || !acct.Name || acct.Status !== "ACTIVE") continue;
      const tags = await getAccountTags(org, acct.Id);
      const ou = await getAccountOuPath(org, acct.Id);
      accounts.push({
        id: acct.Id,
        name: acct.Name,
        email: acct.Email || "",
        env: tags.env || "unknown",
        team: tags.team || "unknown",
        ou,
        tags,
      });
    }
    nextToken = page.NextToken;
  } while (nextToken);

  return accounts;
}

function applyOrgScope(accounts: OrgAccountSummary[], scope: string): OrgAccountSummary[] {
  if (!scope || scope === "all") return accounts;
  const normalized = scope.toLowerCase();
  if (normalized.startsWith("env:")) {
    const env = normalized.split(":")[1];
    return accounts.filter((account) => account.env === env);
  }
  if (normalized.startsWith("ou:")) {
    const ouName = normalized.split(":")[1];
    return accounts.filter((account) => account.ou.toLowerCase().includes(ouName));
  }
  if (normalized.startsWith("team:")) {
    const team = normalized.split(":")[1];
    return accounts.filter((account) => account.team === team);
  }
  if (normalized.startsWith("exclude:")) {
    const excluded = normalized.split(":")[1];
    return accounts.filter((account) => account.env !== excluded);
  }
  const explicitIds = normalized.split(/[,\s]+/).filter((token) => /^\d{12}$/.test(token));
  if (explicitIds.length > 0) {
    const idSet = new Set(explicitIds);
    return accounts.filter((account) => idSet.has(account.id));
  }
  return accounts;
}

async function resolveOrgScope(scope: string, awsConfig: any): Promise<OrgScopeResolution> {
  const accounts = await listOrgAccounts(awsConfig);
  return {
    scope: scope || "all",
    accounts: applyOrgScope(accounts, scope || "all"),
  };
}

function checkOrgBlastRadius(accounts: OrgAccountSummary[]): OrgBlastRadiusResult {
  const byEnv: Record<string, OrgAccountSummary[]> = {};
  for (const account of accounts) {
    const env = account.env || "unknown";
    byEnv[env] ||= [];
    byEnv[env].push(account);
  }

  const blocked: string[] = [];
  const warnings: string[] = [];
  let highestRiskEnv = "dev";
  const riskRank = ["dev", "staging", "prod", "unknown"];

  for (const [env, envAccounts] of Object.entries(byEnv)) {
    const tier = ENV_TIERS[env] || ENV_TIERS.unknown;
    if (riskRank.indexOf(env) > riskRank.indexOf(highestRiskEnv)) {
      highestRiskEnv = env;
    }
    if (envAccounts.length > tier.max_accounts) {
      blocked.push(`Operation targets ${envAccounts.length} ${env} accounts, which exceeds the maximum allowed batch size of ${tier.max_accounts}. Split the rollout into smaller batches.`);
    }
    if (env === "prod" && envAccounts.length > 1) {
      warnings.push(`The scope includes ${envAccounts.length} production accounts. A phased rollout is recommended.`);
    }
    if (env === "unknown") {
      warnings.push("One or more target accounts are not tagged with a recognized environment. They are being treated as production-risk.");
    }
  }

  return {
    blocked,
    warnings,
    by_env: Object.fromEntries(Object.entries(byEnv).map(([env, envAccounts]) => [env, envAccounts.length])),
    total: accounts.length,
    safe_to_proceed: blocked.length === 0,
    highestRiskEnv,
  };
}

function buildScpDocument(template: OrgScpTemplate, allowedRegions?: string[]): Record<string, any> {
  const builder = SCP_TEMPLATES[template];
  if (!builder) {
    throw new Error(`Unsupported SCP template '${template}'.`);
  }
  return builder.build({ allowedRegions });
}

function buildOrgPreview(
  scope: string,
  accounts: OrgAccountSummary[],
  blastRadius: OrgBlastRadiusResult,
  template: OrgScpTemplate,
  policyDocument: Record<string, any>,
  rollbackPlan: string,
): Record<string, any> {
  const tier = ENV_TIERS[blastRadius.highestRiskEnv] || ENV_TIERS.unknown;
  return {
    status: blastRadius.safe_to_proceed ? "preview_only" : "blocked",
    confirmationRequired: true,
    confirmationMode: tier.confirmation,
    scope,
    accountCount: accounts.length,
    byEnv: blastRadius.by_env,
    warnings: blastRadius.warnings,
    blocked: blastRadius.blocked,
    operation: {
      action: "attach_scp",
      template,
      description: SCP_TEMPLATES[template].description,
    },
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      env: account.env,
      team: account.team,
      ou: account.ou,
    })),
    policyDocument,
    rollbackPlan: rollbackPlan || null,
    confirmationHint: tier.confirmation === "double"
      ? `Reply with 'apply to ${accounts.length} accounts' after reviewing the blast radius and rollback plan.`
      : "Reply with 'confirm' to execute this organization-wide operation.",
  };
}

async function executeOrgSCPRollout(
  awsConfig: any,
  accounts: OrgAccountSummary[],
  template: OrgScpTemplate,
  policyDocument: Record<string, any>,
): Promise<{ policyId: string; policyName: string; results: OrgAccountResult[] }> {
  const org = v2Client("Organizations", awsConfig);
  const policyName = `guardian-${template}-${Date.now()}`;
  const created = await withAwsRetry("Organizations.createPolicy", () => org.createPolicy({
    Content: JSON.stringify(policyDocument),
    Description: `Guardian managed SCP rollout for template ${template}`,
    Name: policyName,
    Type: "SERVICE_CONTROL_POLICY",
  }).promise());

  const policyId = created.Policy?.PolicySummary?.Id;
  if (!policyId) {
    throw new Error("Organizations did not return a policy ID for the created SCP.");
  }

  const results = await Promise.all(accounts.map(async (account): Promise<OrgAccountResult> => {
    const started = Date.now();
    try {
      await withAwsRetry("Organizations.attachPolicy", () => org.attachPolicy({
        PolicyId: policyId,
        TargetId: account.id,
      }).promise());
      return {
        account_id: account.id,
        account_name: account.name,
        status: "SUCCESS",
        action_taken: `Attached ${policyName}`,
        duration_ms: Date.now() - started,
      };
    } catch (err: any) {
      return {
        account_id: account.id,
        account_name: account.name,
        status: "FAILED",
        action_taken: `Attach ${policyName}`,
        error: err?.message || "Unknown Organizations attachment failure.",
        duration_ms: Date.now() - started,
      };
    }
  }));

  return { policyId, policyName, results };
}

function buildOrgExecutionSummary(
  scope: string,
  policyName: string,
  policyId: string,
  results: OrgAccountResult[],
): Record<string, any> {
  const successCount = results.filter((result) => result.status === "SUCCESS").length;
  const failedCount = results.filter((result) => result.status === "FAILED").length;
  const lines = [
    "## Organization Operation Summary",
    "",
    `Scope: ${scope}`,
    `Policy: ${policyName} (${policyId})`,
    `Successful targets: ${successCount}`,
    `Failed targets: ${failedCount}`,
    "",
    "### Per-Account Results",
    "",
  ];
  for (const result of results) {
    if (result.status === "SUCCESS") {
      lines.push(`- ${result.account_name} (${result.account_id}) succeeded in ${result.duration_ms} ms.`);
    } else {
      lines.push(`- ${result.account_name} (${result.account_id}) failed. Error: ${result.error || "Unknown error"}`);
    }
  }
  return {
    status: failedCount === 0 ? "executed" : successCount > 0 ? "partial_success" : "failed",
    scope,
    policyName,
    policyId,
    successCount,
    failedCount,
    results,
    formalReport: lines.join("\n"),
  };
}

async function persistOrgOperationHistory(
  supabaseAdmin: any,
  userId: string,
  payload: {
    action: OrgOperationAction;
    scope: string;
    scpTemplate?: OrgScpTemplate;
    accountCount: number;
    envBreakdown: Record<string, number>;
    warnings: string[];
    blocked: string[];
    rollbackPlan?: string;
    status: string;
    previewPayload: Record<string, any>;
    executionSummary?: Record<string, any> | null;
  },
) {
  const { error } = await supabaseAdmin.from("org_operation_history").insert({
    user_id: userId,
    action: payload.action,
    scope: payload.scope,
    scp_template: payload.scpTemplate || null,
    account_count: payload.accountCount,
    env_breakdown: payload.envBreakdown,
    warnings: payload.warnings,
    blocked: payload.blocked,
    rollback_plan: payload.rollbackPlan || null,
    status: payload.status,
    preview_payload: payload.previewPayload,
    execution_summary: payload.executionSummary || null,
  });

  if (error) {
    console.error("Failed to persist org operation history:", error.message);
  }
}

function buildOrgQueryReport(title: string, bodyLines: string[]): string {
  return ["## Organization Query Report", "", `Summary: ${title}`, "", ...bodyLines].join("\n");
}

async function runAccountsWithoutMfaQuery(scope: string, awsConfig: any): Promise<OrgQueryResult> {
  const resolution = await resolveOrgScope(scope, awsConfig);
  const accountsWithoutMfa: Array<{ accountId: string; accountName: string; nonCompliantUsers: string[]; error?: string }> = [];

  for (const account of resolution.accounts) {
    try {
      const assumedConfig = await getAssumedAwsConfig(account.id, awsConfig.region);
      const iam = v2Client("IAM", assumedConfig);
      const users = await iam.listUsers({ MaxItems: 1000 }).promise();
      const nonCompliantUsers: string[] = [];
      for (const user of users.Users || []) {
        if (!user.UserName) continue;
        const mfa = await iam.listMFADevices({ UserName: user.UserName }).promise();
        if ((mfa.MFADevices || []).length === 0) {
          nonCompliantUsers.push(user.UserName);
        }
      }
      if (nonCompliantUsers.length > 0) {
        accountsWithoutMfa.push({ accountId: account.id, accountName: account.name, nonCompliantUsers });
      }
    } catch (err: any) {
      accountsWithoutMfa.push({
        accountId: account.id,
        accountName: account.name,
        nonCompliantUsers: [],
        error: err?.message || "Unable to inspect IAM MFA posture for this account.",
      });
    }
  }

  const lines = accountsWithoutMfa.length === 0
    ? ["All inspected accounts either had no IAM users without MFA or could not be conclusively identified as non-compliant."]
    : accountsWithoutMfa.map((entry) => entry.error
        ? `- ${entry.accountName} (${entry.accountId}) could not be evaluated. Error: ${entry.error}`
        : `- ${entry.accountName} (${entry.accountId}) has ${entry.nonCompliantUsers.length} IAM user(s) without MFA: ${entry.nonCompliantUsers.join(", ")}.`);

  return {
    queryType: "accounts_without_mfa",
    scope: resolution.scope,
    totalAccountsConsidered: resolution.accounts.length,
    formalReport: buildOrgQueryReport("Accounts with IAM users lacking MFA were identified across the selected scope.", lines),
    results: { accounts: accountsWithoutMfa },
    generatedAt: new Date().toISOString(),
  };
}

async function runAccountsWithPublicS3Query(scope: string, awsConfig: any): Promise<OrgQueryResult> {
  const resolution = await resolveOrgScope(scope, awsConfig);
  const findings: Array<{ accountId: string; accountName: string; bucket: string; issue: string }> = [];

  for (const account of resolution.accounts) {
    try {
      const assumedConfig = await getAssumedAwsConfig(account.id, awsConfig.region);
      const s3 = v2Client("S3", assumedConfig);
      const buckets = await s3.listBuckets().promise();
      for (const bucket of buckets.Buckets || []) {
        if (!bucket.Name) continue;
        try {
          const pub = await s3.getPublicAccessBlock({ Bucket: bucket.Name }).promise();
          const cfg = pub.PublicAccessBlockConfiguration || {};
          if (![cfg.BlockPublicAcls, cfg.IgnorePublicAcls, cfg.BlockPublicPolicy, cfg.RestrictPublicBuckets].every(Boolean)) {
            findings.push({
              accountId: account.id,
              accountName: account.name,
              bucket: bucket.Name,
              issue: "Public access block is not fully enabled.",
            });
          }
        } catch {
          findings.push({
            accountId: account.id,
            accountName: account.name,
            bucket: bucket.Name,
            issue: "Public access block configuration is missing or unreadable.",
          });
        }
      }
    } catch (err: any) {
      findings.push({
        accountId: account.id,
        accountName: account.name,
        bucket: "(account scan failed)",
        issue: err?.message || "Unable to inspect S3 configuration in this account.",
      });
    }
  }

  const lines = findings.length === 0
    ? ["No public S3 exposure findings were identified across the selected scope."]
    : findings.map((finding) => `- ${finding.accountName} (${finding.accountId}) bucket ${finding.bucket}: ${finding.issue}`);

  return {
    queryType: "accounts_with_public_s3",
    scope: resolution.scope,
    totalAccountsConsidered: resolution.accounts.length,
    formalReport: buildOrgQueryReport("Public S3 exposure review completed across the selected scope.", lines),
    results: { findings },
    generatedAt: new Date().toISOString(),
  };
}

async function runListOrgScpsQuery(scope: string, awsConfig: any): Promise<OrgQueryResult> {
  const org = v2Client("Organizations", awsConfig);
  const policies = await org.listPolicies({ Filter: "SERVICE_CONTROL_POLICY" }).promise();
  const summaries: Array<{ policyId: string; name: string; attachments: string[] }> = [];
  for (const policy of policies.Policies || []) {
    if (!policy.Id || !policy.Name) continue;
    const targets = await org.listTargetsForPolicy({ PolicyId: policy.Id }).promise();
    summaries.push({
      policyId: policy.Id,
      name: policy.Name,
      attachments: (targets.Targets || []).map((target) => `${target.Name || target.TargetId} (${target.TargetId})`),
    });
  }
  const lines = summaries.length === 0
    ? ["No service control policies were returned by AWS Organizations."]
    : summaries.map((summary) => `- ${summary.name} (${summary.policyId}) is attached to ${summary.attachments.length} target(s): ${summary.attachments.join(", ") || "none"}.`);

  return {
    queryType: "list_org_scps",
    scope: scope || "all",
    totalAccountsConsidered: 0,
    formalReport: buildOrgQueryReport("Service control policy inventory generated from AWS Organizations.", lines),
    results: { policies: summaries },
    generatedAt: new Date().toISOString(),
  };
}

async function runUntaggedEnvAccountsQuery(scope: string, awsConfig: any): Promise<OrgQueryResult> {
  const resolution = await resolveOrgScope(scope, awsConfig);
  const untagged = resolution.accounts.filter((account) => !account.tags.env);
  const lines = untagged.length === 0
    ? ["All accounts in scope have an env tag."]
    : untagged.map((account) => `- ${account.name} (${account.id}) is missing the env tag. Current OU path: ${account.ou}.`);
  return {
    queryType: "untagged_env_accounts",
    scope: resolution.scope,
    totalAccountsConsidered: resolution.accounts.length,
    formalReport: buildOrgQueryReport("Environment tagging review completed across the selected scope.", lines),
    results: { accounts: untagged },
    generatedAt: new Date().toISOString(),
  };
}

async function runOrgStructureQuery(_scope: string, awsConfig: any): Promise<OrgQueryResult> {
  const accounts = await listOrgAccounts(awsConfig);
  const lines = accounts.map((account) => `- ${account.ou} :: ${account.name} (${account.id}) env=${account.env} team=${account.team}`);
  return {
    queryType: "org_structure",
    scope: "all",
    totalAccountsConsidered: accounts.length,
    formalReport: buildOrgQueryReport("Organization structure rendered from AWS Organizations.", lines),
    results: { accounts },
    generatedAt: new Date().toISOString(),
  };
}

async function runGuardianOnboardingStatusQuery(scope: string, awsConfig: any): Promise<OrgQueryResult> {
  const resolution = await resolveOrgScope(scope, awsConfig);
  const status: Array<{ accountId: string; accountName: string; onboarded: boolean; detail: string }> = [];
  for (const account of resolution.accounts) {
    try {
      await getAssumedAwsConfig(account.id, awsConfig.region);
      status.push({
        accountId: account.id,
        accountName: account.name,
        onboarded: true,
        detail: `${ORG_ROLE_NAME} could be assumed successfully.`,
      });
    } catch (err: any) {
      status.push({
        accountId: account.id,
        accountName: account.name,
        onboarded: false,
        detail: err?.message || `${ORG_ROLE_NAME} could not be assumed.`,
      });
    }
  }
  const lines = status.map((entry) => `- ${entry.accountName} (${entry.accountId}) onboarding status: ${entry.onboarded ? "READY" : "NOT READY"}. ${entry.detail}`);
  return {
    queryType: "guardian_onboarding_status",
    scope: resolution.scope,
    totalAccountsConsidered: resolution.accounts.length,
    formalReport: buildOrgQueryReport("Guardian cross-account onboarding status evaluated across the selected scope.", lines),
    results: { accounts: status },
    generatedAt: new Date().toISOString(),
  };
}

async function runOrgQuery(queryType: OrgQueryType, scope: string, awsConfig: any): Promise<OrgQueryResult> {
  switch (queryType) {
    case "accounts_without_mfa":
      return runAccountsWithoutMfaQuery(scope, awsConfig);
    case "accounts_with_public_s3":
      return runAccountsWithPublicS3Query(scope, awsConfig);
    case "list_org_scps":
      return runListOrgScpsQuery(scope, awsConfig);
    case "untagged_env_accounts":
      return runUntaggedEnvAccountsQuery(scope, awsConfig);
    case "org_structure":
      return runOrgStructureQuery(scope, awsConfig);
    case "guardian_onboarding_status":
      return runGuardianOnboardingStatusQuery(scope, awsConfig);
  }
}

const RUNBOOK_LIBRARY: Record<string, RunbookTemplate> = {
  data_breach_response: {
    id: "data_breach_response",
    name: "Data breach incident response",
    description: "Contain, investigate, and remediate a suspected data exposure incident.",
    trigger: "suspected_data_exfiltration",
    tags: ["security", "incident-response"],
    steps: [
      { id: "snapshot_iam", name: "Snapshot current IAM state", type: "query", risk: "auto", action: "capture_iam_snapshot", params: {}, on_failure: "pause" },
      { id: "identify_exposure", name: "Identify exposed resources", type: "query", risk: "auto", action: "scan_public_resources", params: { services: ["s3", "ec2", "rds"] }, on_failure: "pause" },
      { id: "block_public_s3", name: "Block public S3 access", type: "aws_action", risk: "confirm", action: "put_public_access_block", params: { bucket: "{bucket_name}", block_all: true }, rollback: { action: "restore_public_access_block", params: "{previous_public_access_block}" }, on_failure: "pause" },
      { id: "rotate_keys", name: "Rotate all active access keys", type: "aws_action", risk: "confirm", action: "rotate_access_keys", params: { users: "{all_active_users}" }, on_failure: "pause" },
      { id: "revoke_sessions", name: "Revoke active IAM sessions", type: "human_task", risk: "manual", action: "attach_deny_all_policy", params: { scope: "all_non_guardian_roles" }, on_failure: "abort" },
      { id: "notify_team", name: "Notify security team", type: "notify", risk: "auto", action: "send_incident_alert", params: { severity: "CRITICAL", summary: "{incident_summary}" }, on_failure: "skip" },
      { id: "verify_cloudtrail", name: "Verify CloudTrail is enabled", type: "query", risk: "auto", action: "verify_cloudtrail_enabled", params: { all_regions: true }, on_failure: "skip" },
      { id: "generate_report", name: "Generate incident report", type: "query", risk: "auto", action: "generate_incident_report", params: { include: ["timeline", "affected_resources", "actions_taken", "open_items"] }, on_failure: "skip" },
    ],
  },
  public_s3_lockdown: {
    id: "public_s3_lockdown",
    name: "Public S3 bucket lockdown",
    description: "Immediately secure a bucket that was made public.",
    trigger: "s3_public_access_block_removed",
    tags: ["security", "s3", "incident-response"],
    steps: [
      { id: "capture_config", name: "Capture current bucket config", type: "query", risk: "auto", action: "get_bucket_full_config", params: { bucket: "{bucket_name}" }, on_failure: "pause" },
      { id: "block_public", name: "Re-enable public access block", type: "aws_action", risk: "auto", action: "put_public_access_block", params: { bucket: "{bucket_name}", block_all: true }, rollback: { action: "restore_public_access_block", params: "{previous_public_access_block}" }, on_failure: "pause" },
      { id: "audit_objects", name: "Check for publicly exposed objects", type: "query", risk: "auto", action: "list_public_objects", params: { bucket: "{bucket_name}" }, on_failure: "skip" },
      { id: "check_who_changed", name: "Identify who removed the block", type: "query", risk: "auto", action: "query_cloudtrail", params: { event: "DeleteBucketPublicAccessBlock", resource: "{bucket_name}", hours_back: 2 }, on_failure: "skip" },
      { id: "notify", name: "Notify team with findings", type: "notify", risk: "auto", action: "send_incident_alert", params: { summary: "{findings_summary}" }, on_failure: "skip" },
    ],
  },
  cost_spike_remediation: {
    id: "cost_spike_remediation",
    name: "Cost spike remediation",
    description: "Identify and contain an unexpected cost spike.",
    trigger: "cost_anomaly_detected",
    tags: ["cost", "automation"],
    steps: [
      { id: "identify_driver", name: "Identify cost spike driver", type: "query", risk: "auto", action: "get_cost_breakdown_by_service", params: { days: 3 }, on_failure: "pause" },
      { id: "find_idle", name: "Find idle resources in the spike service", type: "query", risk: "auto", action: "find_idle_resources", params: { service: "{spike_service}" }, on_failure: "pause" },
      { id: "stop_idle_nonprod", name: "Stop idle non-production instances", type: "aws_action", risk: "confirm", action: "stop_ec2_instances", params: { instance_ids: "{idle_nonprod_instances}" }, rollback: { action: "start_ec2_instances", params: "{idle_nonprod_instances}" }, on_failure: "pause" },
      { id: "set_budget_alert", name: "Set budget alert for next 7 days", type: "aws_action", risk: "auto", action: "create_budget_alert", params: { threshold: "{budget_threshold}", period: "DAILY" }, on_failure: "skip" },
    ],
  },
};


function inferRunbookId(rawQuery: string): string {
  const query = rawQuery.toLowerCase();
  if (/\bpublic s3\b|\bpublic bucket\b|\blockdown\b/.test(query)) return "public_s3_lockdown";
  if (/\bcost spike\b|\bcost anomaly\b|\bspend spike\b/.test(query)) return "cost_spike_remediation";
  if (/\bdata breach\b|\bincident response\b|\bbreach\b/.test(query)) return "data_breach_response";
  throw new Error("No supported runbook matched the request.");
}

function isRunbookDryRun(rawQuery: string, dryRun?: boolean): boolean {
  if (typeof dryRun === "boolean") return dryRun;
  return /\bdry[- ]run\b/.test(rawQuery.toLowerCase());
}

function extractBucketName(rawQuery: string): string | null {
  const bucketToken = rawQuery.match(/\b([a-z0-9][a-z0-9.-]{2,62})\b/gi)?.find((token) => token.includes("-") || token.includes("."));
  return bucketToken || null;
}

async function findPublicBuckets(awsConfig: any): Promise<string[]> {
  const s3 = v2Client("S3", awsConfig);
  const buckets = await s3.listBuckets().promise();
  const publicBuckets: string[] = [];
  for (const bucket of buckets.Buckets || []) {
    if (!bucket.Name) continue;
    try {
      const pub = await s3.getPublicAccessBlock({ Bucket: bucket.Name }).promise();
      const cfg = pub.PublicAccessBlockConfiguration || {};
      if (![cfg.BlockPublicAcls, cfg.IgnorePublicAcls, cfg.BlockPublicPolicy, cfg.RestrictPublicBuckets].every(Boolean)) {
        publicBuckets.push(bucket.Name);
      }
    } catch {
      publicBuckets.push(bucket.Name);
    }
  }
  return publicBuckets;
}

async function listActiveIamUsers(awsConfig: any): Promise<string[]> {
  const iam = v2Client("IAM", awsConfig);
  const users = await iam.listUsers({ MaxItems: 1000 }).promise();
  return (users.Users || []).map((user) => user.UserName).filter(Boolean) as string[];
}

async function captureIamSnapshotSummary(awsConfig: any): Promise<Record<string, any>> {
  const iam = v2Client("IAM", awsConfig);
  const users = await iam.listUsers({ MaxItems: 1000 }).promise();
  const summary = [];
  for (const user of users.Users || []) {
    if (!user.UserName) continue;
    const [mfa, keys] = await Promise.all([
      iam.listMFADevices({ UserName: user.UserName }).promise(),
      iam.listAccessKeys({ UserName: user.UserName }).promise(),
    ]);
    summary.push({
      user: user.UserName,
      mfaEnabled: (mfa.MFADevices || []).length > 0,
      accessKeyCount: (keys.AccessKeyMetadata || []).length,
    });
  }
  return { userCount: summary.length, users: summary };
}

async function scanPublicResourcesSummary(awsConfig: any): Promise<Record<string, any>> {
  const publicBuckets = await findPublicBuckets(awsConfig);
  return {
    s3: { publicBuckets },
    ec2: { note: "EC2 public resource expansion is not yet automated in this runbook slice." },
    rds: { note: "RDS public resource expansion is not yet automated in this runbook slice." },
  };
}

async function getBucketFullConfig(awsConfig: any, bucket: string): Promise<Record<string, any>> {
  const s3 = v2Client("S3", awsConfig);
  let publicAccessBlock = null;
  let versioning = null;
  let encryption = null;
  try {
    publicAccessBlock = (await s3.getPublicAccessBlock({ Bucket: bucket }).promise()).PublicAccessBlockConfiguration || null;
  } catch { /* noop */ }
  try {
    versioning = await s3.getBucketVersioning({ Bucket: bucket }).promise();
  } catch { /* noop */ }
  try {
    encryption = await s3.getBucketEncryption({ Bucket: bucket }).promise();
  } catch { /* noop */ }
  return { bucket, publicAccessBlock, versioning, encryption };
}

async function listPublicObjectsSummary(awsConfig: any, bucket: string): Promise<Record<string, any>> {
  const s3 = v2Client("S3", awsConfig);
  const listed = await s3.listObjectsV2({ Bucket: bucket, MaxKeys: 25 }).promise();
  return {
    bucket,
    objectCountSampled: (listed.Contents || []).length,
    sampledKeys: (listed.Contents || []).map((item) => item.Key).filter(Boolean),
  };
}

async function queryCloudTrailSummary(awsConfig: any, eventName: string, resourceName: string, hoursBack: number): Promise<Record<string, any>> {
  const cloudTrail = v2Client("CloudTrail", awsConfig);
  const endTime = new Date();
  const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const response = await cloudTrail.lookupEvents({
    LookupAttributes: [{ AttributeKey: "EventName", AttributeValue: eventName }],
    StartTime: startTime,
    EndTime: endTime,
    MaxResults: 20,
  }).promise();
  const events = (response.Events || []).filter((event) => (event.Resources || []).some((resource) => resource.ResourceName === resourceName));
  const actor = events[0]?.Username || "Unknown";
  return {
    eventName,
    resourceName,
    actor,
    eventCount: events.length,
    events: events.map((event) => ({
      time: toIsoString(event.EventTime),
      username: event.Username || "Unknown",
      eventId: event.EventId || "",
    })),
  };
}

async function verifyCloudTrailEnabledSummary(awsConfig: any): Promise<Record<string, any>> {
  const cloudTrail = v2Client("CloudTrail", awsConfig);
  const trails = await cloudTrail.describeTrails({ includeShadowTrails: true }).promise();
  return {
    trailCount: (trails.trailList || []).length,
    trails: (trails.trailList || []).map((trail) => ({
      name: trail.Name,
      isMultiRegionTrail: trail.IsMultiRegionTrail,
      homeRegion: trail.HomeRegion,
    })),
  };
}

async function stopEc2InstancesAction(awsConfig: any, instanceIds: string[]): Promise<Record<string, any>> {
  const ec2 = v2Client("EC2", awsConfig);
  if (instanceIds.length === 0) {
    return { stoppedInstances: [], note: "No non-production idle instances were identified." };
  }
  const result = await ec2.stopInstances({ InstanceIds: instanceIds }).promise();
  return {
    stoppedInstances: (result.StoppingInstances || []).map((instance) => instance.InstanceId).filter(Boolean),
  };
}

async function startEc2InstancesAction(awsConfig: any, instanceIds: string[]): Promise<Record<string, any>> {
  const ec2 = v2Client("EC2", awsConfig);
  if (instanceIds.length === 0) return { startedInstances: [] };
  const result = await ec2.startInstances({ InstanceIds: instanceIds }).promise();
  return {
    startedInstances: (result.StartingInstances || []).map((instance) => instance.InstanceId).filter(Boolean),
  };
}

async function createBudgetAlertAction(awsConfig: any, accountId: string, threshold: number, notificationEmail?: string | null): Promise<Record<string, any>> {
  if (!notificationEmail) {
    return { created: false, note: "No notification email is configured, so the budget alert was not created." };
  }
  const budgets = v2Client("Budgets", awsConfig);
  const budgetName = `guardian-budget-${Date.now()}`;
  await budgets.createBudget({
    AccountId: accountId,
    Budget: {
      BudgetName: budgetName,
      BudgetLimit: { Amount: threshold.toFixed(2), Unit: "USD" },
      BudgetType: "COST",
      CostFilters: {},
      CostTypes: { IncludeTax: true },
      TimeUnit: "DAILY",
    },
    NotificationsWithSubscribers: [{
      Notification: {
        ComparisonOperator: "GREATER_THAN",
        NotificationType: "ACTUAL",
        Threshold: threshold,
        ThresholdType: "ABSOLUTE_VALUE",
      },
      Subscribers: [{
        Address: notificationEmail,
        SubscriptionType: "EMAIL",
      }],
    }],
  }).promise();
  return { created: true, budgetName };
}

async function ensureAlertTopicAndSubscription(
  awsConfig: any,
  notificationEmail: string,
): Promise<{ topicArn: string; subscriptionStatus: "existing" | "pending_confirmation" }> {
  const sns = v2Client("SNS", awsConfig);
  const accountId = await getAwsAccountId(awsConfig);
  const topicName = `cloudpilot-alerts-${accountId}`;
  const topic = await sns.createTopic({ Name: topicName }).promise();
  const topicArn = topic.TopicArn;
  if (!topicArn) {
    throw new Error("Failed to resolve the SNS topic ARN for notifications.");
  }

  const subscriptions = await sns.listSubscriptionsByTopic({ TopicArn: topicArn }).promise();
  const existing = (subscriptions.Subscriptions || []).find(
    (subscription) => subscription.Protocol === "email" && subscription.Endpoint === notificationEmail,
  );

  if (existing) {
    return {
      topicArn,
      subscriptionStatus: existing.SubscriptionArn === "PendingConfirmation" ? "pending_confirmation" : "existing",
    };
  }

  await sns.subscribe({
    TopicArn: topicArn,
    Protocol: "email",
    Endpoint: notificationEmail,
  }).promise();

  return { topicArn, subscriptionStatus: "pending_confirmation" };
}

async function sendIncidentNotification(
  awsConfig: any,
  notificationEmail: string | null,
  subject: string,
  message: string,
): Promise<Record<string, any>> {
  if (!notificationEmail) {
    return { sent: false, target: "No notification email configured", note: "Notification was skipped because no email is configured." };
  }

  const sns = v2Client("SNS", awsConfig);
  const { topicArn, subscriptionStatus } = await ensureAlertTopicAndSubscription(awsConfig, notificationEmail);

  const publishResult = await sns.publish({
    TopicArn: topicArn,
    Subject: subject.slice(0, 100),
    Message: message,
  }).promise();

  return {
    sent: true,
    target: notificationEmail,
    topicArn,
    subscriptionStatus,
    messageId: publishResult.MessageId || null,
  };
}

async function rotateAccessKeysAction(awsConfig: any, users: string[]): Promise<Record<string, any>> {
  const iam = v2Client("IAM", awsConfig);
  const rotated: Array<{ user: string; oldKeyIds: string[]; newKeyId?: string }> = [];
  for (const user of users) {
    const keys = await iam.listAccessKeys({ UserName: user }).promise();
    const oldKeyIds = (keys.AccessKeyMetadata || []).map((key) => key.AccessKeyId).filter(Boolean) as string[];
    const created = await iam.createAccessKey({ UserName: user }).promise();
    rotated.push({
      user,
      oldKeyIds,
      newKeyId: created.AccessKey?.AccessKeyId,
    });
  }
  return { rotated };
}

function resolveTemplateValue(value: any, context: Record<string, any>): any {
  if (typeof value === "string") {
    if (/^\{[a-zA-Z0-9_]+\}$/.test(value)) {
      const key = value.slice(1, -1);
      return context[key];
    }
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
      const resolved = context[key];
      return resolved === undefined || resolved === null ? "" : String(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolveTemplateValue(nested, context)]));
  }
  return value;
}

function describeRunbookStep(step: RunbookStepTemplate, params: Record<string, any>): string {
  switch (step.action) {
    case "put_public_access_block":
      return `Block all public access on bucket ${params.bucket}.`;
    case "rotate_access_keys":
      return `Rotate access keys for ${Array.isArray(params.users) ? params.users.length : 0} IAM users.`;
    case "stop_ec2_instances":
      return `Stop ${Array.isArray(params.instance_ids) ? params.instance_ids.length : 0} EC2 instances.`;
    case "create_budget_alert":
      return `Create a daily budget alert at $${params.threshold}.`;
    case "send_incident_alert":
      return `Send the incident notification summary.`;
    default:
      return step.name;
  }
}

function estimateRunbookImpact(step: RunbookStepTemplate, params: Record<string, any>): string {
  if (step.type === "query") return "Read-only inspection.";
  if (step.type === "notify") return "Notification only.";
  if (step.action === "rotate_access_keys") return "Existing key consumers will need updated credentials immediately.";
  if (step.action === "stop_ec2_instances") return `${Array.isArray(params.instance_ids) ? params.instance_ids.length : 0} instances may become unavailable until restarted.`;
  if (step.action === "put_public_access_block") return "Public S3 access will be blocked immediately.";
  return "Operational change.";
}

async function planRunbookSteps(runbook: RunbookTemplate, rawQuery: string, awsConfig: any): Promise<ResolvedRunbookStep[]> {
  const context: Record<string, any> = {
    incident_summary: rawQuery,
    findings_summary: rawQuery,
  };
  const lowerQuery = rawQuery.toLowerCase();

  if (runbook.id === "public_s3_lockdown" || runbook.id === "data_breach_response") {
    context.bucket_name = extractBucketName(rawQuery) || (await findPublicBuckets(awsConfig))[0] || null;
    if (!context.bucket_name) {
      throw new Error("No exposed bucket could be resolved for the requested runbook.");
    }
    const config = await getBucketFullConfig(awsConfig, context.bucket_name);
    context.previous_public_access_block = { bucket: context.bucket_name, previousConfig: config.publicAccessBlock };
    context.findings_summary = `The runbook identified bucket ${context.bucket_name} as the primary exposed S3 resource.`;
  }

  if (runbook.id === "data_breach_response") {
    context.all_active_users = await listActiveIamUsers(awsConfig);
  }

  if (runbook.id === "cost_spike_remediation") {
    const costData = await fetchCostData(awsConfig, 3);
    const anomalies = detectCostAnomalies(costData.daily_by_service, []);
    const topAnomaly = anomalies.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity])[0];
    context.spike_service = topAnomaly?.service || "Amazon EC2";
    const idle = await findIdleEc2Instances(awsConfig);
    context.idle_nonprod_instances = idle.map((instance) => instance.id);
    context.budget_threshold = Math.max(100, Number(((topAnomaly?.today || 100) * 2).toFixed(2)));
  }

  if (lowerQuery.includes("soc2")) {
    context.incident_summary = "SOC 2 pre-audit runbook planning request.";
  }

  return runbook.steps.map((step) => {
    const params = resolveTemplateValue(step.params, context);
    return {
      ...step,
      params,
      human_readable: describeRunbookStep(step, params),
      estimated_impact: estimateRunbookImpact(step, params),
    };
  });
}

function buildRunbookPreview(runbook: RunbookTemplate, steps: ResolvedRunbookStep[], executionId: string, dryRun: boolean): string {
  const lines = [
    "## Runbook Preview",
    "",
    `Runbook: ${runbook.name}`,
    `Execution ID: ${executionId}`,
    `Mode: ${dryRun ? "Dry run" : "Execution ready"}`,
    "",
    `Guardian will execute ${steps.length} step(s) in sequence:`,
    "",
  ];
  steps.forEach((step, index) => {
    const riskLabel = step.risk.toUpperCase();
    lines.push(`${index + 1}. ${riskLabel.padEnd(7)} ${step.name}`);
    lines.push(`   Action: ${step.human_readable}`);
    lines.push(`   Impact: ${step.estimated_impact}`);
  });
  lines.push("");
  lines.push(dryRun
    ? "Dry-run mode will execute query and notification steps, but will stop before any AWS action steps."
    : "Automatic steps can proceed immediately. Guardian will pause whenever a confirmation step is reached.");
  lines.push(`Type "run playbook" to begin${dryRun ? " the dry run" : ""}.`);
  return lines.join("\n");
}

async function createRunbookExecution(
  supabaseAdmin: any,
  payload: Omit<RunbookExecutionRecord, "created_at" | "updated_at">,
) {
  const record = {
    ...payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("runbook_executions").insert({
    id: record.id,
    user_id: record.user_id,
    conversation_id: record.conversation_id,
    runbook_id: record.runbook_id,
    runbook_name: record.runbook_name,
    trigger_query: record.trigger_query,
    dry_run: record.dry_run,
    status: record.status,
    current_step_index: record.current_step_index,
    steps: record.steps,
    results: record.results,
    approved_by: record.approved_by,
    last_error: record.last_error,
  });
  if (error) throw new Error(`Failed to create runbook execution: ${error.message}`);
}

async function updateRunbookExecution(
  supabaseAdmin: any,
  executionId: string,
  patch: Record<string, any>,
) {
  const { error } = await supabaseAdmin
    .from("runbook_executions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", executionId);
  if (error) throw new Error(`Failed to update runbook execution: ${error.message}`);
}

async function upsertRunbookStepStatus(
  supabaseAdmin: any,
  executionId: string,
  step: ResolvedRunbookStep,
  stepOrder: number,
  status: string,
  output: string,
) {
  const { error } = await supabaseAdmin
    .from("runbook_execution_steps")
    .upsert({
      execution_id: executionId,
      step_id: step.id,
      step_order: stepOrder,
      step_name: step.name,
      risk: step.risk,
      status,
      output: output.slice(0, 2000),
      updated_at: new Date().toISOString(),
    }, { onConflict: "execution_id,step_id" });
  if (error) throw new Error(`Failed to update runbook step status: ${error.message}`);
}

async function getLatestRunbookExecution(
  supabaseAdmin: any,
  userId: string,
  conversationId: string | null,
): Promise<any | null> {
  let query = supabaseAdmin
    .from("runbook_executions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["PLANNED", "IN_PROGRESS", "WAITING_CONFIRMATION"])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch runbook execution: ${error.message}`);
  return data?.[0] || null;
}

async function executeRunbookStep(
  step: ResolvedRunbookStep,
  awsConfig: any,
  notificationEmail: string | null,
): Promise<Record<string, any>> {
  switch (step.action) {
    case "capture_iam_snapshot":
      return captureIamSnapshotSummary(awsConfig);
    case "scan_public_resources":
      return scanPublicResourcesSummary(awsConfig);
    case "get_bucket_full_config":
      return getBucketFullConfig(awsConfig, String(step.params.bucket));
    case "put_public_access_block": {
      const s3 = v2Client("S3", awsConfig);
      await s3.putPublicAccessBlock({
        Bucket: String(step.params.bucket),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }).promise();
      return { bucket: step.params.bucket, status: "Public access block applied." };
    }
    case "list_public_objects":
      return listPublicObjectsSummary(awsConfig, String(step.params.bucket));
    case "query_cloudtrail":
      return queryCloudTrailSummary(awsConfig, String(step.params.event), String(step.params.resource), Number(step.params.hours_back || 2));
    case "send_incident_alert":
      return sendIncidentNotification(
        awsConfig,
        notificationEmail,
        "CloudPilot incident notification",
        String(step.params.summary || "Incident notification prepared."),
      );
    case "verify_cloudtrail_enabled":
      return verifyCloudTrailEnabledSummary(awsConfig);
    case "generate_incident_report":
      return { reportGenerated: true, included: step.params.include || [] };
    case "get_cost_breakdown_by_service": {
      const cost = await fetchCostData(awsConfig, Number(step.params.days || 3));
      return { period: cost.period, topEntries: cost.daily_by_service.slice(-15) };
    }
    case "find_idle_resources": {
      const idle = await findIdleEc2Instances(awsConfig);
      return { service: step.params.service, idleInstances: idle };
    }
    case "stop_ec2_instances":
      return stopEc2InstancesAction(awsConfig, Array.isArray(step.params.instance_ids) ? step.params.instance_ids : []);
    case "start_ec2_instances":
      return startEc2InstancesAction(awsConfig, Array.isArray(step.params.instance_ids) ? step.params.instance_ids : []);
    case "create_budget_alert":
      return createBudgetAlertAction(awsConfig, await getAwsAccountId(awsConfig), Number(step.params.threshold || 100), notificationEmail);
    case "rotate_access_keys":
      return rotateAccessKeysAction(awsConfig, Array.isArray(step.params.users) ? step.params.users : []);
    default:
      return { status: "manual", note: `No automatic executor is available for ${step.action}.` };
  }
}

async function continueRunbookExecution(
  supabaseAdmin: any,
  execution: any,
  awsConfig: any,
  notificationEmail: string | null,
  approvedBy: string,
  latestUserMessage: string,
): Promise<Record<string, any>> {
  const steps = (execution.steps || []) as ResolvedRunbookStep[];
  const results = Array.isArray(execution.results) ? [...execution.results] : [];
  let rollbackAvailable = 0;

  await updateRunbookExecution(supabaseAdmin, execution.id, {
    status: "IN_PROGRESS",
    approved_by: approvedBy,
  });

  for (let index = Number(execution.current_step_index || 0); index < steps.length; index += 1) {
    const step = steps[index];

    if (execution.dry_run && step.type === "aws_action") {
      await upsertRunbookStepStatus(supabaseAdmin, execution.id, step, index + 1, "DRY_RUN_SKIPPED", "Dry-run mode skipped this AWS action step.");
      results.push({
        step_id: step.id,
        status: "DRY_RUN_SKIPPED",
        output: "Dry-run mode skipped this AWS action step.",
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    if (step.risk === "confirm" && execution.status !== "WAITING_CONFIRMATION") {
      await updateRunbookExecution(supabaseAdmin, execution.id, {
        status: "WAITING_CONFIRMATION",
        current_step_index: index,
        results,
      });
      await upsertRunbookStepStatus(supabaseAdmin, execution.id, step, index + 1, "WAITING_CONFIRMATION", step.human_readable);
      return {
        status: "WAITING_CONFIRMATION",
        executionId: execution.id,
        currentStep: index + 1,
        totalSteps: steps.length,
        step,
        message: `Step ${index + 1}/${steps.length} is waiting for confirmation. Reply with 'confirm' to proceed or 'abort' to stop the runbook.`,
      };
    }

    if (step.risk === "confirm" && execution.status === "WAITING_CONFIRMATION" && !isExplicitConfirmation(latestUserMessage)) {
      return {
        status: "WAITING_CONFIRMATION",
        executionId: execution.id,
        currentStep: index + 1,
        totalSteps: steps.length,
        step,
        message: `Step ${index + 1}/${steps.length} remains paused. Reply with 'confirm' to proceed or 'abort' to stop the runbook.`,
      };
    }

    if (step.risk === "manual") {
      await upsertRunbookStepStatus(supabaseAdmin, execution.id, step, index + 1, "MANUAL_REQUIRED", step.human_readable);
      results.push({
        step_id: step.id,
        status: "MANUAL_REQUIRED",
        output: step.human_readable,
        timestamp: new Date().toISOString(),
      });
      await updateRunbookExecution(supabaseAdmin, execution.id, {
        status: "WAITING_CONFIRMATION",
        current_step_index: index + 1,
        results,
      });
      return {
        status: "WAITING_CONFIRMATION",
        executionId: execution.id,
        currentStep: index + 1,
        totalSteps: steps.length,
        step,
        message: `Step ${index + 1}/${steps.length} requires a human task. Review the instruction and reply with 'confirm' when you are ready for Guardian to continue.`,
      };
    }

    try {
      const output = await executeRunbookStep(step, awsConfig, notificationEmail);
      await upsertRunbookStepStatus(supabaseAdmin, execution.id, step, index + 1, "SUCCESS", JSON.stringify(output));
      results.push({
        step_id: step.id,
        status: "SUCCESS",
        output,
        timestamp: new Date().toISOString(),
      });
      if (step.rollback) rollbackAvailable += 1;
      await updateRunbookExecution(supabaseAdmin, execution.id, {
        current_step_index: index + 1,
        results,
      });
      execution.status = "IN_PROGRESS";
    } catch (err: any) {
      const errorMessage = err?.message || `Runbook step ${step.id} failed.`;
      await upsertRunbookStepStatus(supabaseAdmin, execution.id, step, index + 1, "FAILED", errorMessage);
      results.push({
        step_id: step.id,
        status: "FAILED",
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      const failureStatus = step.on_failure === "abort" ? "FAILED_ABORTED" : "WAITING_CONFIRMATION";
      await updateRunbookExecution(supabaseAdmin, execution.id, {
        status: failureStatus,
        current_step_index: index,
        results,
        last_error: errorMessage,
      });
      return {
        status: failureStatus,
        executionId: execution.id,
        currentStep: index + 1,
        totalSteps: steps.length,
        step,
        error: errorMessage,
        message: failureStatus === "FAILED_ABORTED"
          ? "The runbook aborted because a required step failed."
          : "The runbook paused because a step failed. Review the error and decide whether to retry manually or abort.",
      };
    }
  }

  const finalStatus: RunbookExecutionStatus = execution.dry_run ? "DRY_RUN_COMPLETED" : "COMPLETED";
  await updateRunbookExecution(supabaseAdmin, execution.id, {
    status: finalStatus,
    current_step_index: steps.length,
    results,
    last_error: null,
  });

  const completionLines = [
    "## Runbook Completion Report",
    "",
    `Runbook: ${execution.runbook_name}`,
    `Execution ID: ${execution.id}`,
    `Status: ${finalStatus}`,
    "",
    "### Timeline",
    "",
    ...results.map((result: any) => `- ${result.timestamp}: ${result.step_id} -> ${result.status}`),
    "",
    `Rollback-ready steps completed: ${rollbackAvailable}`,
  ];

  return {
    status: finalStatus,
    executionId: execution.id,
    results,
    formalReport: completionLines.join("\n"),
  };
}

function parseEventNotifyChannels(rawQuery: string, notificationEmail: string | null): string[] {
  const query = rawQuery.toLowerCase();
  const channels = new Set<string>();

  const slackMatch = rawQuery.match(/slack:\s*(#[\w-]+)/i);
  if (slackMatch?.[1]) {
    channels.add(`slack:${slackMatch[1]}`);
  } else if (/\bsecurity team\b/.test(query) || /\bslack\b/.test(query)) {
    channels.add("slack:#security");
  }

  if (/\bpage\b|\bpagerduty\b|\bon-call\b|\bwake up\b/.test(query)) {
    channels.add("pagerduty");
  }

  if ((/\bemail\b/.test(query) || channels.size === 0) && notificationEmail) {
    channels.add(`email:${sanitizeString(notificationEmail, 320)}`);
  }

  return Array.from(channels);
}

function buildEventPolicyName(rawQuery: string): string {
  const normalized = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || `event-policy-${Date.now()}`;
}

function parseEventResponsePolicyFromQuery(
  rawQuery: string,
  notificationEmail: string | null,
): EventResponsePolicyRecord {
  const query = rawQuery.toLowerCase();
  const notifyChannels = parseEventNotifyChannels(rawQuery, notificationEmail);

  if ((/\bport 22\b/.test(query) || /\bssh\b/.test(query)) && (/\bworld\b/.test(query) || /0\.0\.0\.0\/0/.test(query))) {
    return {
      id: crypto.randomUUID(),
      policy_id: `policy-${crypto.randomUUID().slice(0, 8)}`,
      name: "Auto-close world-open SSH",
      trigger_event: "AuthorizeSecurityGroupIngress",
      trigger_conditions: {
        source_cidr: IPV4_ANYWHERE,
        port: 22,
      },
      risk_threshold: "CRITICAL",
      response_type: "all",
      response_action: "revoke_sg_rule",
      response_params: {},
      notify_channels: notifyChannels,
      raw_query: rawQuery,
      created_by: "user",
      is_active: true,
    };
  }

  if (/\bnew iam user\b/.test(query) || (/\biam user\b/.test(query) && /\bcreated\b/.test(query))) {
    return {
      id: crypto.randomUUID(),
      policy_id: `policy-${crypto.randomUUID().slice(0, 8)}`,
      name: "Alert on new IAM user creation",
      trigger_event: "CreateUser",
      trigger_conditions: {
        actor_is_guardian: false,
      },
      risk_threshold: "HIGH",
      response_type: "notify",
      response_action: "send_alert",
      response_params: {},
      notify_channels: notifyChannels,
      raw_query: rawQuery,
      created_by: "user",
      is_active: true,
    };
  }

  if (/\broot account\b/.test(query) || (/\broot\b/.test(query) && /\bused\b/.test(query))) {
    return {
      id: crypto.randomUUID(),
      policy_id: `policy-${crypto.randomUUID().slice(0, 8)}`,
      name: "Alert on root account usage",
      trigger_event: "*",
      trigger_conditions: {
        actor_type: "root",
      },
      risk_threshold: "CRITICAL",
      response_type: "all",
      response_action: "trigger_runbook",
      response_params: {
        runbook: "root_account_usage_response",
      },
      notify_channels: notifyChannels,
      raw_query: rawQuery,
      created_by: "user",
      is_active: true,
    };
  }

  if ((/\bcloudtrail\b/.test(query) || /\btrail\b/.test(query)) && (/\bdisabled\b/.test(query) || /\bstop logging\b/.test(query) || /\bdelete trail\b/.test(query))) {
    return {
      id: crypto.randomUUID(),
      policy_id: `policy-${crypto.randomUUID().slice(0, 8)}`,
      name: "Restore CloudTrail if disabled",
      trigger_event: "StopLogging",
      trigger_conditions: {},
      risk_threshold: "CRITICAL",
      response_type: "all",
      response_action: "restore_cloudtrail_logging",
      response_params: {
        runbook: "cloudtrail_disabled_response",
      },
      notify_channels: notifyChannels,
      raw_query: rawQuery,
      created_by: "user",
      is_active: true,
    };
  }

  throw new Error("Unsupported event response policy request. Supported rules currently include world-open SSH, new IAM user creation, root account usage, and CloudTrail disablement.");
}

async function saveEventResponsePolicy(supabaseAdmin: any, userId: string, policy: EventResponsePolicyRecord) {
  const { error } = await supabaseAdmin.from("event_response_policies").insert({
    id: policy.id,
    user_id: userId,
    policy_id: policy.policy_id,
    name: policy.name,
    trigger_event: policy.trigger_event,
    trigger_conditions: policy.trigger_conditions,
    risk_threshold: policy.risk_threshold,
    response_type: policy.response_type,
    response_action: policy.response_action,
    response_params: policy.response_params,
    notify_channels: policy.notify_channels,
    raw_query: policy.raw_query,
    created_by: userId,
    is_active: policy.is_active,
  });

  if (error) {
    throw new Error(`Failed to store the event response policy: ${error.message}`);
  }
}

async function fetchUserEventResponsePolicies(supabaseAdmin: any, userId: string): Promise<EventResponsePolicyRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("event_response_policies")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch event response policies: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    policy_id: row.policy_id,
    name: row.name,
    trigger_event: row.trigger_event,
    trigger_conditions: row.trigger_conditions || {},
    risk_threshold: row.risk_threshold,
    response_type: row.response_type,
    response_action: row.response_action,
    response_params: row.response_params || {},
    notify_channels: Array.isArray(row.notify_channels) ? row.notify_channels : [],
    raw_query: row.raw_query || "",
    created_by: row.created_by || "user",
    is_active: Boolean(row.is_active),
  }));
}

function buildFormalEventPolicyListReport(
  builtIns: EventResponsePolicyRecord[],
  userPolicies: EventResponsePolicyRecord[],
): string {
  const lines: string[] = [];
  lines.push("## Event Response Policies");
  lines.push("");
  lines.push(`Built-in policies: ${builtIns.length}`);
  lines.push(`User-defined active policies: ${userPolicies.length}`);
  lines.push("");

  if (builtIns.length > 0) {
    lines.push("### Built-In Policies");
    lines.push("");
    for (const policy of builtIns) {
      lines.push(`- ${policy.name}: Trigger \`${policy.trigger_event}\`, minimum risk ${policy.risk_threshold}, response \`${policy.response_type}\`.`);
    }
    lines.push("");
  }

  if (userPolicies.length > 0) {
    lines.push("### User-Defined Policies");
    lines.push("");
    for (const policy of userPolicies) {
      lines.push(`- ${policy.name}: Trigger \`${policy.trigger_event}\`, minimum risk ${policy.risk_threshold}, response \`${policy.response_type}\`, channels ${policy.notify_channels.join(", ") || "none"}.`);
    }
  } else {
    lines.push("No user-defined event response policies are currently active.");
  }

  return lines.join("\n");
}

function buildFormalCreatedEventPolicyReport(policy: EventResponsePolicyRecord): string {
  const lines: string[] = [];
  lines.push("## Event Response Policy Created");
  lines.push("");
  lines.push(`Name: ${policy.name}`);
  lines.push(`Policy ID: ${policy.policy_id}`);
  lines.push(`Trigger event: ${policy.trigger_event}`);
  lines.push(`Risk threshold: ${policy.risk_threshold}`);
  lines.push(`Response type: ${policy.response_type}`);
  lines.push(`Response action: ${policy.response_action}`);
  lines.push(`Notify channels: ${policy.notify_channels.join(", ") || "none"}`);
  lines.push(`Original request: ${policy.raw_query}`);
  return lines.join("\n");
}

function parseCloudTrailLookupEvent(event: any): Record<string, any> | null {
  try {
    const parsed = event.CloudTrailEvent ? JSON.parse(event.CloudTrailEvent) : {};
    return {
      ...parsed,
      eventID: parsed.eventID || event.EventId || crypto.randomUUID(),
      eventName: parsed.eventName || event.EventName || "Unknown",
      eventTime: parsed.eventTime || toIsoString(event.EventTime) || new Date().toISOString(),
      awsRegion: parsed.awsRegion || event.AwsRegion || "unknown",
      username: parsed.username || event.Username || null,
      readOnly: parsed.readOnly ?? event.ReadOnly ?? null,
      resources: parsed.resources || event.Resources || [],
    };
  } catch {
    return null;
  }
}

function getCloudTrailItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function extractEventPortsAndCidrs(detail: Record<string, any>): { ports: number[]; cidrs: string[] } {
  const ports = new Set<number>();
  const cidrs = new Set<string>();
  const params = detail.requestParameters || {};

  for (const permission of getCloudTrailItems(params.ipPermissions)) {
    const fromPort = Number(permission.fromPort);
    const toPort = Number(permission.toPort);
    if (Number.isInteger(fromPort)) ports.add(fromPort);
    if (Number.isInteger(toPort)) ports.add(toPort);

    for (const range of getCloudTrailItems(permission.ipRanges)) {
      if (range?.cidrIp) cidrs.add(String(range.cidrIp));
    }
    for (const range of getCloudTrailItems(permission.ipv6Ranges)) {
      if (range?.cidrIpv6) cidrs.add(String(range.cidrIpv6));
    }
  }

  return {
    ports: Array.from(ports),
    cidrs: Array.from(cidrs),
  };
}

function extractCloudTrailResource(detail: Record<string, any>): [string, string] {
  const eventName = String(detail.eventName || "");
  const params = detail.requestParameters || {};
  const extractors: Record<string, (value: Record<string, any>) => [string, string]> = {
    AuthorizeSecurityGroupIngress: (value) => [value.groupId || "unknown", "security_group"],
    AuthorizeSecurityGroupEgress: (value) => [value.groupId || "unknown", "security_group"],
    RevokeSecurityGroupIngress: (value) => [value.groupId || "unknown", "security_group"],
    RevokeSecurityGroupEgress: (value) => [value.groupId || "unknown", "security_group"],
    DeleteBucketPublicAccessBlock: (value) => [value.bucketName || "unknown", "s3_bucket"],
    PutBucketPublicAccessBlock: (value) => [value.bucketName || "unknown", "s3_bucket"],
    PutBucketPolicy: (value) => [value.bucketName || "unknown", "s3_bucket"],
    DeleteBucketPolicy: (value) => [value.bucketName || "unknown", "s3_bucket"],
    DeleteBucketEncryption: (value) => [value.bucketName || "unknown", "s3_bucket"],
    PutBucketEncryption: (value) => [value.bucketName || "unknown", "s3_bucket"],
    PutBucketAcl: (value) => [value.bucketName || "unknown", "s3_bucket"],
    AttachUserPolicy: (value) => [value.userName || "unknown", "iam_user"],
    DetachUserPolicy: (value) => [value.userName || "unknown", "iam_user"],
    PutUserPolicy: (value) => [value.userName || "unknown", "iam_user"],
    CreateUser: (value) => [value.userName || "unknown", "iam_user"],
    DeleteUser: (value) => [value.userName || "unknown", "iam_user"],
    CreateAccessKey: (value) => [value.userName || "unknown", "iam_user"],
    DeleteAccessKey: (value) => [value.userName || "unknown", "iam_user"],
    UpdateAccessKey: (value) => [value.userName || "unknown", "iam_user"],
    DeactivateMFADevice: (value) => [value.userName || "unknown", "iam_user"],
    DeleteTrail: (value) => [value.name || "unknown", "cloudtrail"],
    StopLogging: (value) => [value.name || "unknown", "cloudtrail"],
    RunInstances: () => ["new_instance", "ec2_instance"],
  };

  const extractor = extractors[eventName];
  if (extractor) return extractor(params);

  const firstResource = Array.isArray(detail.resources) ? detail.resources[0] : null;
  if (firstResource?.ARN) return [String(firstResource.ARN), "resource"];
  if (firstResource?.resourceName) return [String(firstResource.resourceName), "resource"];
  return [params.resourceId || "unknown", "unknown"];
}

function scoreCloudTrailEventRisk(detail: Record<string, any>, actorType: string, resourceId: string): { level: UnifiedAuditSeverity; reason: string } {
  const eventName = String(detail.eventName || "");
  const params = detail.requestParameters || {};
  const extracted = extractEventPortsAndCidrs(detail);

  if (actorType === "root") {
    return { level: "CRITICAL", reason: "The root account was used. Root usage should not occur during normal operations." };
  }

  if (eventName === "AuthorizeSecurityGroupIngress" && extracted.cidrs.includes(IPV4_ANYWHERE)) {
    return { level: "CRITICAL", reason: "A world-open inbound security group rule was added." };
  }
  if (eventName === "DeleteBucketPublicAccessBlock") {
    return { level: "CRITICAL", reason: "An S3 public access block was removed." };
  }
  if (eventName === "DeleteTrail" || eventName === "StopLogging") {
    return { level: "CRITICAL", reason: "CloudTrail logging was disabled or deleted." };
  }
  if (eventName === "DeactivateMFADevice") {
    return { level: "CRITICAL", reason: "An MFA device was deactivated for an IAM user." };
  }
  if (eventName === "AttachUserPolicy" && JSON.stringify(params).includes("AdministratorAccess")) {
    return { level: "HIGH", reason: "AdministratorAccess was attached to an IAM user." };
  }
  if (eventName === "CreateAccessKey" && actorType !== "iam_user") {
    return { level: "HIGH", reason: "An access key was created by a non-owner identity." };
  }
  if (eventName === "PutBucketPolicy") {
    return { level: "HIGH", reason: "An S3 bucket policy was modified." };
  }
  if (eventName === "CreateUser") {
    return { level: "HIGH", reason: "A new IAM user was created." };
  }

  return { level: "MEDIUM", reason: `${eventName} was detected on ${resourceId}.` };
}

function classifyAndEnrichCloudTrailEvent(detail: Record<string, any>): EnrichedEvent {
  const identity = detail.userIdentity || {};
  const actorArn = String(identity.arn || identity.sessionContext?.sessionIssuer?.arn || "unknown");
  const actorType = ({
    Root: "root",
    IAMUser: "iam_user",
    AssumedRole: "assumed_role",
    AWSService: "service",
    AWSAccount: "account",
  } as Record<string, string>)[String(identity.type || "")] || "unknown";

  const actorIsGuardian =
    actorArn.toLowerCase().includes("guardian") ||
    actorArn.includes("GuardianExecutionRole") ||
    String(identity.sessionContext?.sessionIssuer?.userName || "").toLowerCase().startsWith("guardian");

  const [resourceId, resourceType] = extractCloudTrailResource(detail);
  const { level, reason } = scoreCloudTrailEventRisk(detail, actorType, resourceId);
  const { ports, cidrs } = extractEventPortsAndCidrs(detail);

  return {
    event_id: String(detail.eventID || crypto.randomUUID()),
    event_name: String(detail.eventName || "Unknown"),
    event_time: toIsoString(detail.eventTime) || new Date().toISOString(),
    actor_arn: actorArn,
    actor_type: actorType,
    actor_is_guardian: actorIsGuardian,
    source_ip: String(detail.sourceIPAddress || "unknown"),
    resource_id: String(resourceId || "unknown"),
    resource_type: String(resourceType || "unknown"),
    region: String(detail.awsRegion || "unknown"),
    risk_level: level,
    risk_reason: reason,
    requested_ports: ports,
    source_cidrs: cidrs,
    raw_event: detail,
  };
}

function eventMatchesPolicy(event: EnrichedEvent, policy: EventResponsePolicyRecord): boolean {
  if (policy.trigger_event !== "*" && policy.trigger_event !== event.event_name) return false;
  if (SEVERITY_ORDER[event.risk_level] > SEVERITY_ORDER[policy.risk_threshold]) return false;

  const conditions = policy.trigger_conditions || {};
  if (conditions.actor_type && conditions.actor_type !== event.actor_type) return false;
  if (typeof conditions.actor_is_guardian === "boolean" && conditions.actor_is_guardian !== event.actor_is_guardian) return false;
  if (conditions.source_cidr && !event.source_cidrs.includes(String(conditions.source_cidr))) return false;
  if (conditions.port && !event.requested_ports.includes(Number(conditions.port))) return false;

  return true;
}

async function fetchCloudTrailEventsForReplay(awsConfig: any, hoursBack: number): Promise<EnrichedEvent[]> {
  const cloudTrail = v2Client("CloudTrail", awsConfig);
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);
  const events: EnrichedEvent[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  do {
    const response = await cloudTrail.lookupEvents({
      StartTime: startTime,
      EndTime: endTime,
      MaxResults: 50,
      NextToken: nextToken,
    }).promise();

    for (const event of response.Events || []) {
      const detail = parseCloudTrailLookupEvent(event);
      if (!detail?.eventName) continue;
      if (!WATCHED_CLOUDTRAIL_EVENTS.has(String(detail.eventName))) continue;
      events.push(classifyAndEnrichCloudTrailEvent(detail));
    }

    nextToken = response.NextToken;
    pages += 1;
  } while (nextToken && pages < 5);

  return events;
}

function deduplicateReplayEvents(events: EnrichedEvent[]): { deduplicated: EnrichedEvent[]; suppressed: number } {
  const dedup = new Set<string>();
  const deduplicated: EnrichedEvent[] = [];
  let suppressed = 0;

  for (const event of events) {
    const key = `${event.event_name}:${event.resource_id}:${event.event_time.slice(0, 16)}`;
    if (dedup.has(key)) {
      suppressed += 1;
      continue;
    }
    dedup.add(key);
    deduplicated.push(event);
  }

  return { deduplicated, suppressed };
}

function describePolicyOutcome(policy: EventResponsePolicyRecord): string {
  if (policy.response_type === "auto_fix") {
    return `Would auto-fix using ${policy.response_action}`;
  }
  if (policy.response_type === "notify") {
    return `Would notify ${policy.notify_channels.join(", ") || "configured channels"}`;
  }
  if (policy.response_type === "runbook") {
    return `Would trigger runbook ${policy.response_params?.runbook || policy.response_action}`;
  }
  return `Would auto-fix and notify, with runbook escalation where configured`;
}

function buildFormalEventReplayReport(result: EventReplayResult): string {
  const lines: string[] = [];
  lines.push("## CloudTrail Event Replay Report");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Replay window: last ${result.hoursBack} hour(s)`);
  lines.push(`Watched events evaluated: ${result.watchedEvents}`);
  lines.push(`Duplicate events suppressed: ${result.deduplicatedEvents}`);
  lines.push(`Policies evaluated: ${result.policiesEvaluated}`);
  lines.push(`Matched events: ${result.matchedEvents}`);
  lines.push("");

  if (result.matches.length === 0) {
    lines.push("No replayed CloudTrail events matched the active built-in or user-defined response policies in the selected time window.");
    return lines.join("\n");
  }

  lines.push("### Matching Events");
  lines.push("");
  for (const match of result.matches) {
    const event = match.event;
    lines.push(`- ${event.event_time} | ${event.risk_level} | ${event.event_name} on ${event.resource_id} in ${event.region}. ${event.risk_reason}`);
    lines.push(`  Actor: ${event.actor_arn}`);
    for (const policy of match.policies) {
      lines.push(`  Policy: ${policy.name}. ${describePolicyOutcome(policy)}.`);
    }
  }
  lines.push("");
  lines.push("Replay mode is a backtest only. No remediation or notification actions were executed during this analysis.");
  return lines.join("\n");
}


function buildSecurityGroupPermission(args: SecurityGroupRuleArgs, sourceGroupId?: string) {
  const permission: any = {
    IpProtocol: args.protocol,
    FromPort: args.fromPort,
    ToPort: args.toPort,
  };

  if (sourceGroupId) {
    permission.UserIdGroupPairs = [{ GroupId: sourceGroupId, Description: args.description || undefined }];
  } else if (args.cidr) {
    if (args.cidr.includes(":")) {
      permission.Ipv6Ranges = [{ CidrIpv6: args.cidr, Description: args.description || undefined }];
    } else {
      permission.IpRanges = [{ CidrIp: args.cidr, Description: args.description || undefined }];
    }
  } else {
    throw new Error("A CIDR or source security group is required.");
  }

  return permission;
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

    for (const toolCall of toolCalls) {
          if (toolCall.function.name === "manage_runbook_execution") {
            const startTime = Date.now();
            try {
              if (!userId) {
                throw new Error("Authentication is required for runbook execution.");
              }

              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const rawQuery = sanitizeString(rawArgs.rawQuery, 2000);
              const explicitDryRun = typeof rawArgs.dryRun === "boolean" ? Boolean(rawArgs.dryRun) : undefined;
              const normalizedQuery = rawQuery.toLowerCase().trim();

              if (!rawQuery) {
                throw new Error("A runbook request is required.");
              }

              const latestExecution = await getLatestRunbookExecution(supabaseAdmin, userId, conversationId || null);

              if (normalizedQuery === "abort") {
                if (!latestExecution) {
                  throw new Error("No active runbook execution was found to abort.");
                }
                await updateRunbookExecution(supabaseAdmin, latestExecution.id, { status: "ABORTED" });
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    status: "ABORTED",
                    executionId: latestExecution.id,
                    message: "The active runbook execution was aborted.",
                  }),
                } as any);
                continue;
              }

              if (normalizedQuery === "run playbook") {
                if (!latestExecution) {
                  throw new Error("No planned runbook was found to start.");
                }
                const continued = await continueRunbookExecution(
                  supabaseAdmin,
                  latestExecution,
                  awsConfig,
                  notificationEmail || null,
                  userId,
                  latestUserMessage,
                );
                const execTime = Date.now() - startTime;
                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "MULTI",
                    aws_operation: "runRunbook",
                    aws_region: awsConfig.region,
                    status: String(continued.status).toLowerCase(),
                    validator_result: "HIGH_RISK",
                    execution_time_ms: execTime,
                  }).then();
                }
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(continued),
                } as any);
                continue;
              }

              if (normalizedQuery === "confirm" && latestExecution?.status === "WAITING_CONFIRMATION") {
                const continued = await continueRunbookExecution(
                  supabaseAdmin,
                  latestExecution,
                  awsConfig,
                  notificationEmail || null,
                  userId,
                  latestUserMessage,
                );
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(continued),
                } as any);
                continue;
              }

              const runbookId = inferRunbookId(rawQuery);
              const runbook = RUNBOOK_LIBRARY[runbookId];
              const dryRun = isRunbookDryRun(rawQuery, explicitDryRun);
              const steps = await planRunbookSteps(runbook, rawQuery, awsConfig);
              const executionId = crypto.randomUUID();

              await createRunbookExecution(supabaseAdmin, {
                id: executionId,
                user_id: userId,
                conversation_id: conversationId || null,
                runbook_id: runbook.id,
                runbook_name: runbook.name,
                trigger_query: rawQuery,
                dry_run: dryRun,
                status: "PLANNED",
                current_step_index: 0,
                steps,
                results: [],
                approved_by: null,
                last_error: null,
              });

              const execTime = Date.now() - startTime;
              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "planRunbook",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "HIGH_RISK",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "MULTI",
                operation: "planRunbook",
                region: awsConfig.region,
                status: "success",
                runbookId: runbook.id,
                executionId,
                dryRun,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  status: "PLANNED",
                  executionId,
                  runbookId: runbook.id,
                  runbookName: runbook.name,
                  dryRun,
                  steps,
                  formalReport: buildRunbookPreview(runbook, steps, executionId, dryRun),
                }),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const errorMessage = err?.message || "Runbook execution failed.";

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "MULTI",
                  aws_operation: "manageRunbookExecution",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: err?.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "HIGH_RISK",
                  execution_time_ms: execTime,
                }).then();
              }

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMessage }),
              } as any);
            }
          }

          if (toolCall.function.name === "manage_event_response_policy") {
            const startTime = Date.now();
            try {
              if (!userId) {
                throw new Error("Authentication is required to manage event response policies.");
              }

              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const rawQuery = sanitizeString(rawArgs.rawQuery, 2000);
              if (!rawQuery) {
                throw new Error("An event response policy request is required.");
              }

              const normalizedQuery = rawQuery.toLowerCase();
              const isListRequest =
                /\blist\b/.test(normalizedQuery) ||
                /\bshow\b/.test(normalizedQuery) ||
                /\bwhat\b/.test(normalizedQuery) ||
                /\bmy event rules\b/.test(normalizedQuery) ||
                /\bresponse policies\b/.test(normalizedQuery);

              if (isListRequest) {
                const userPolicies = await fetchUserEventResponsePolicies(supabaseAdmin, userId);
                const execTime = Date.now() - startTime;

                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "CLOUDTRAIL",
                    aws_operation: "listEventResponsePolicies",
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
                    status: "listed",
                    builtInPolicies: BUILT_IN_EVENT_RESPONSE_POLICIES,
                    userPolicies,
                    formalReport: buildFormalEventPolicyListReport(BUILT_IN_EVENT_RESPONSE_POLICIES, userPolicies),
                  }),
                } as any);
                continue;
              }

              const policy = parseEventResponsePolicyFromQuery(rawQuery, notificationEmail || null);
              await saveEventResponsePolicy(supabaseAdmin, userId, policy);
              const execTime = Date.now() - startTime;

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "CLOUDTRAIL",
                  aws_operation: "manageEventResponsePolicy",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "CLOUDTRAIL",
                operation: "manageEventResponsePolicy",
                region: awsConfig.region,
                status: "success",
                policyId: policy.policy_id,
                triggerEvent: policy.trigger_event,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  status: "stored",
                  policy,
                  formalReport: buildFormalCreatedEventPolicyReport(policy),
                }),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const errorMessage = err?.message || "Event response policy request failed.";

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "CLOUDTRAIL",
                  aws_operation: "manageEventResponsePolicy",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: err?.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMessage }),
              } as any);
            }
          }

          if (toolCall.function.name === "replay_cloudtrail_events") {
            const startTime = Date.now();
            try {
              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const hoursBack = Math.max(1, Math.min(168, Number(rawArgs.hoursBack || 24)));
              const replayResult = await replayCloudTrailEvents(supabaseAdmin, userId || null, awsConfig, hoursBack);
              const execTime = Date.now() - startTime;

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "CLOUDTRAIL",
                  aws_operation: "replayCloudTrailEvents",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "CLOUDTRAIL",
                operation: "replayCloudTrailEvents",
                region: awsConfig.region,
                status: "success",
                hoursBack,
                matchedEvents: replayResult.matchedEvents,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(replayResult),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const errorMessage = err?.message || "CloudTrail replay failed.";

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "CLOUDTRAIL",
                  aws_operation: "replayCloudTrailEvents",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: err?.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMessage }),
              } as any);
            }
          }

          if (toolCall.function.name === "run_org_query") {
            const startTime = Date.now();
            try {
              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const queryType = sanitizeString(rawArgs.queryType, 64) as OrgQueryType;
              const scope = sanitizeString(rawArgs.scope || "all", 128) || "all";
              const queryResult = await runOrgQuery(queryType, scope, awsConfig);
              const execTime = Date.now() - startTime;

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "ORGANIZATIONS",
                  aws_operation: "runOrgQuery",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "ORGANIZATIONS",
                operation: "runOrgQuery",
                region: awsConfig.region,
                status: "success",
                queryType,
                scope,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(queryResult),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const errorMessage = err?.message || "Organization query failed.";

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "ORGANIZATIONS",
                  aws_operation: "runOrgQuery",
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
                service: "ORGANIZATIONS",
                operation: "runOrgQuery",
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

          if (toolCall.function.name === "manage_org_operation") {
            const startTime = Date.now();
            try {
              if (!userId) {
                throw new Error("Authentication is required for organization-wide write operations.");
              }

              const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
              const action = sanitizeString(rawArgs.action, 64) as OrgOperationAction;
              const scope = sanitizeString(rawArgs.scope || "all", 128) || "all";
              const scpTemplate = sanitizeString(rawArgs.scpTemplate, 128) as OrgScpTemplate;
              const allowedRegions = Array.isArray(rawArgs.allowedRegions)
                ? rawArgs.allowedRegions.map((region: unknown) => sanitizeString(region, 64)).filter(Boolean)
                : [];
              const rollbackPlan = sanitizeString(rawArgs.rollbackPlan, 500);

              if (action !== "attach_scp") {
                throw new Error(`Unsupported organization action '${action}'.`);
              }

              const resolution = await resolveOrgScope(scope, awsConfig);
              const blastRadius = checkOrgBlastRadius(resolution.accounts);
              const policyDocument = buildScpDocument(scpTemplate, allowedRegions);
              const highestTier = ENV_TIERS[blastRadius.highestRiskEnv] || ENV_TIERS.unknown;
              const countConfirmation = parseOrgConfirmationCount(latestUserMessage);
              const hasRequiredCountConfirmation = countConfirmation === resolution.accounts.length;
              const requiresDoubleConfirmation = highestTier.confirmation === "double";
              const requiredApprovals = requiresDoubleConfirmation ? 2 : 1;

              if (resolution.accounts.length === 0) {
                throw new Error("The requested scope resolved to zero accounts.");
              }

              const previewPayload = buildOrgPreview(
                scope,
                resolution.accounts,
                blastRadius,
                scpTemplate,
                policyDocument,
                rollbackPlan,
              );

              const orgIdempotencyPayload = {
                action,
                scope,
                scpTemplate,
                allowedRegions,
                rollbackPlan,
                accountIds: resolution.accounts.map((account) => account.id).sort(),
              };
              const orgRequestHash = await sha256(stableStringify(orgIdempotencyPayload));
              const orgRequestKey = `org-operation:${orgRequestHash}`;
              const approvalSummary = `Attach SCP template '${scpTemplate}' across ${resolution.accounts.length} account(s) in scope '${scope}'.`;
              const approvalRequest = await upsertApprovalRequest(supabaseAdmin, {
                requestKey: orgRequestKey,
                requestHash: orgRequestHash,
                operationName: "manage_org_operation",
                requesterUserId: userId,
                summary: approvalSummary,
                riskLevel: requiresDoubleConfirmation ? "HIGH" : "MEDIUM",
                requiredApprovals,
                previewPayload,
                requestPayload: orgIdempotencyPayload,
                evidencePayload: {
                  scope,
                  blastRadius,
                  warnings: previewPayload.warnings,
                  rollbackPlan: rollbackPlan || null,
                },
              });

              if (!blastRadius.safe_to_proceed) {
                await persistOrgOperationHistory(supabaseAdmin, userId, {
                  action,
                  scope,
                  scpTemplate,
                  accountCount: resolution.accounts.length,
                  envBreakdown: blastRadius.by_env,
                  warnings: previewPayload.warnings,
                  blocked: previewPayload.blocked,
                  rollbackPlan,
                  status: "blocked",
                  previewPayload,
                });
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    ...previewPayload,
                    approval: buildApprovalSummaryPayload(
                      approvalRequest,
                      approvalRequest.current_approvals || 0,
                      requiredApprovals,
                      "This request is blocked until the blast-radius issues are resolved.",
                    ),
                  }),
                } as any);
                continue;
              }

              if (highestTier.rollback_plan === "required" && !rollbackPlan) {
                const rollbackPreviewPayload = {
                  ...previewPayload,
                  status: "preview_only",
                  warnings: [
                    ...previewPayload.warnings,
                    "A rollback plan is required before this operation can be executed for production or unknown environments.",
                  ],
                };
                await persistOrgOperationHistory(supabaseAdmin, userId, {
                  action,
                  scope,
                  scpTemplate,
                  accountCount: resolution.accounts.length,
                  envBreakdown: blastRadius.by_env,
                  warnings: rollbackPreviewPayload.warnings,
                  blocked: rollbackPreviewPayload.blocked,
                  rollbackPlan,
                  status: "preview_only",
                  previewPayload: rollbackPreviewPayload,
                });
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    ...rollbackPreviewPayload,
                    approval: buildApprovalSummaryPayload(
                      approvalRequest,
                      approvalRequest.current_approvals || 0,
                      requiredApprovals,
                      "Add a rollback plan before this request can move forward.",
                    ),
                  }),
                } as any);
                continue;
              }

              const confirmed = requiresDoubleConfirmation
                ? hasRequiredCountConfirmation
                : userHasConfirmedMutation || hasRequiredCountConfirmation;

              if (!confirmed) {
                await persistOrgOperationHistory(supabaseAdmin, userId, {
                  action,
                  scope,
                  scpTemplate,
                  accountCount: resolution.accounts.length,
                  envBreakdown: blastRadius.by_env,
                  warnings: previewPayload.warnings,
                  blocked: previewPayload.blocked,
                  rollbackPlan,
                  status: "preview_only",
                  previewPayload,
                });
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    ...previewPayload,
                    approval: buildApprovalSummaryPayload(
                      approvalRequest,
                      approvalRequest.current_approvals || 0,
                      requiredApprovals,
                      requiresDoubleConfirmation
                        ? `A distinct second approver is required. After review, an approver should confirm with 'apply to ${resolution.accounts.length} accounts'.`
                        : "Reply with 'confirm' to approve and execute this request.",
                    ),
                  }),
                } as any);
                continue;
              }

              await recordApprovalAction(supabaseAdmin, approvalRequest.id, userId);
              const approvalState = await refreshApprovalRequestState(
                supabaseAdmin,
                approvalRequest.id,
                requiredApprovals,
              );

              if (approvalState.approvalCount < requiredApprovals) {
                const awaitingApprovalPayload = {
                  ...previewPayload,
                  status: "awaiting_additional_approval",
                  approval: buildApprovalSummaryPayload(
                    approvalState.request,
                    approvalState.approvalCount,
                    requiredApprovals,
                    `A distinct approver must approve this request before execution. Current approvals: ${approvalState.approvalCount}/${requiredApprovals}.`,
                  ),
                };

                await persistOrgOperationHistory(supabaseAdmin, userId, {
                  action,
                  scope,
                  scpTemplate,
                  accountCount: resolution.accounts.length,
                  envBreakdown: blastRadius.by_env,
                  warnings: previewPayload.warnings,
                  blocked: previewPayload.blocked,
                  rollbackPlan,
                  status: "awaiting_additional_approval",
                  previewPayload: awaitingApprovalPayload,
                });

                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(awaitingApprovalPayload),
                } as any);
                continue;
              }

              const orgClaim = await claimIdempotencyKey(
                supabaseAdmin,
                userId,
                "manage_org_operation",
                orgRequestKey,
                orgRequestHash,
              );

              if (orgClaim.existing?.status === "success" && orgClaim.existing.response_payload) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(orgClaim.existing.response_payload),
                } as any);
                continue;
              }

              if (orgClaim.existing?.status === "pending") {
                throw new CloudPilotError("This organization rollout is already in progress.", {
                  code: "IDEMPOTENT_OPERATION_PENDING",
                  category: "conflict",
                  status: 409,
                });
              }

              const execution = await executeOrgSCPRollout(awsConfig, resolution.accounts, scpTemplate, policyDocument);
              const execTime = Date.now() - startTime;
              const summary = buildOrgExecutionSummary(scope, execution.policyName, execution.policyId, execution.results);
              await storeIdempotencySuccess(supabaseAdmin, "manage_org_operation", orgRequestKey, summary);
              await markApprovalRequestExecuted(supabaseAdmin, approvalRequest.id, summary);
              await persistOrgOperationHistory(supabaseAdmin, userId, {
                action,
                scope,
                scpTemplate,
                accountCount: resolution.accounts.length,
                envBreakdown: blastRadius.by_env,
                warnings: previewPayload.warnings,
                blocked: previewPayload.blocked,
                rollbackPlan,
                status: String(summary.status),
                previewPayload,
                executionSummary: summary,
              });

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "ORGANIZATIONS",
                  aws_operation: "manageOrgOperation",
                  aws_region: awsConfig.region,
                  status: summary.status,
                  validator_result: requiresDoubleConfirmation ? "HIGH_RISK" : "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "ORGANIZATIONS",
                operation: "manageOrgOperation",
                region: awsConfig.region,
                status: summary.status,
                scope,
                accountCount: resolution.accounts.length,
                successCount: summary.successCount,
                failedCount: summary.failedCount,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(summary),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const typedError = toCloudPilotError(err);
              const errorMessage = typedError.message || "Organization operation failed.";
              try {
                const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
                const scope = sanitizeString(rawArgs.scope || "all", 128) || "all";
                const scpTemplate = sanitizeString(rawArgs.scpTemplate, 128) as OrgScpTemplate;
                const allowedRegions = Array.isArray(rawArgs.allowedRegions)
                  ? rawArgs.allowedRegions.map((region: unknown) => sanitizeString(region, 64)).filter(Boolean)
                  : [];
                const rollbackPlan = sanitizeString(rawArgs.rollbackPlan, 500);
                const resolution = await resolveOrgScope(scope, awsConfig);
                const requestHash = await sha256(stableStringify({
                  action: sanitizeString(rawArgs.action, 64),
                  scope,
                  scpTemplate,
                  allowedRegions,
                  rollbackPlan,
                  accountIds: resolution.accounts.map((account) => account.id).sort(),
                }));
                await storeIdempotencyFailure(
                  supabaseAdmin,
                  "manage_org_operation",
                  `org-operation:${requestHash}`,
                  { error: errorMessage, code: typedError.code, category: typedError.category },
                );
                const { data: approvalRequest } = await supabaseAdmin
                  .from("approval_requests")
                  .select("id")
                  .eq("request_key", `org-operation:${requestHash}`)
                  .maybeSingle();
                if (approvalRequest?.id) {
                  await markApprovalRequestFailed(supabaseAdmin, approvalRequest.id, {
                    error: errorMessage,
                    code: typedError.code,
                    category: typedError.category,
                  });
                }
              } catch {
                // Best-effort failure recording only.
              }

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "ORGANIZATIONS",
                  aws_operation: "manageOrgOperation",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: typedError.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "HIGH_RISK",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "ORGANIZATIONS",
                operation: "manageOrgOperation",
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

          if (toolCall.function.name === "manage_security_group_rule") {
            const startTime = Date.now();
            try {
              const rawArgs = JSON.parse(toolCall.function.arguments);
              const args: SecurityGroupRuleArgs = {
                action: rawArgs.action,
                targetGroupIdentifier: sanitizeSecurityGroupIdentifier(rawArgs.targetGroupIdentifier),
                protocol: sanitizeProtocol(rawArgs.protocol),
                fromPort: normalizePort(rawArgs.fromPort),
                toPort: normalizePort(rawArgs.toPort),
                cidr: rawArgs.cidr ? sanitizeCidr(rawArgs.cidr) : undefined,
                sourceGroupIdentifier: rawArgs.sourceGroupIdentifier
                  ? sanitizeSecurityGroupIdentifier(rawArgs.sourceGroupIdentifier)
                  : undefined,
                description: rawArgs.description ? sanitizeString(rawArgs.description, 255) : undefined,
              };

              if (!args.targetGroupIdentifier) {
                throw new Error("A target security group is required.");
              }
              if (!args.cidr && !args.sourceGroupIdentifier) {
                throw new Error("A CIDR or source security group is required.");
              }

              const ec2 = v2Client("EC2", awsConfig);
              const targetGroup = await resolveSecurityGroup(ec2, args.targetGroupIdentifier);
              const sourceGroup = args.sourceGroupIdentifier
                ? await resolveSecurityGroup(ec2, args.sourceGroupIdentifier)
                : null;
              const risk = classifySecurityGroupRisk(targetGroup, args, Boolean(sourceGroup));
              const permission = buildSecurityGroupPermission(args, sourceGroup?.groupId);
              const operationName = buildSecurityGroupOperationName(args.action);
              const existingMatch = findExistingMatchingPermission(targetGroup, args, permission, sourceGroup?.groupId);
              const wouldBeNoop = isAllowAction(args.action) ? Boolean(existingMatch) : !existingMatch;
              const requiredApprovals = requiredApprovalsForSecurityGroup(targetGroup);
              const sgIdempotencyPayload = {
                region: awsConfig.region,
                action: args.action,
                targetGroupId: targetGroup.groupId,
                sourceGroupId: sourceGroup?.groupId || null,
                cidr: args.cidr || null,
                permission,
              };
              const sgRequestHash = await sha256(stableStringify(sgIdempotencyPayload));
              const sgRequestKey = `security-group:${sgRequestHash}`;
              const execTime = Date.now() - startTime;

              if (!risk.allowed) {
                const blockedPayload = {
                  status: "blocked",
                  riskLevel: risk.riskLevel,
                  targetGroup,
                  requestedRule: {
                    action: args.action,
                    protocol: args.protocol,
                    fromPort: args.fromPort,
                    toPort: args.toPort,
                    cidr: args.cidr || null,
                    sourceGroupId: sourceGroup?.groupId || null,
                  },
                  reasons: risk.reasons,
                };

                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "EC2",
                    aws_operation: "manageSecurityGroupRule",
                    aws_region: awsConfig.region,
                    status: "blocked",
                    error_message: risk.reasons.join(" "),
                    validator_result: risk.riskLevel,
                    execution_time_ms: execTime,
                  }).then();
                }

                pushAuditToAws(awsConfig, {
                  timestamp: new Date().toISOString(),
                  userId,
                  service: "EC2",
                  operation: "manageSecurityGroupRule",
                  region: awsConfig.region,
                  status: "blocked",
                  riskLevel: risk.riskLevel,
                  targetGroupId: targetGroup.groupId,
                  reasons: risk.reasons,
                  executionTimeMs: execTime,
                });

                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(blockedPayload),
                } as any);
                continue;
              }

              if (!userHasConfirmedMutation) {
                const preview = {
                  status: "preview_only",
                  confirmationRequired: true,
                  riskLevel: risk.riskLevel,
                  direction: getSecurityGroupDirection(args.action),
                  operation: operationName,
                  targetGroup,
                  sourceGroup,
                  requestedRule: {
                    action: args.action,
                    protocol: args.protocol,
                    fromPort: args.fromPort,
                    toPort: args.toPort,
                    cidr: args.cidr || null,
                    sourceGroupId: sourceGroup?.groupId || null,
                    description: args.description || null,
                  },
                  permission,
                  existingMatch: existingMatch ? {
                    protocol: existingMatch.IpProtocol || null,
                    fromPort: existingMatch.FromPort ?? null,
                    toPort: existingMatch.ToPort ?? null,
                    targets: ipPermissionTargets(existingMatch),
                  } : null,
                  noOp: wouldBeNoop,
                  reasons: risk.reasons,
                  summary: `${isAllowAction(args.action) ? "Add" : "Remove"} ${getSecurityGroupDirection(args.action)} ${args.protocol}:${args.fromPort}-${args.toPort} on ${targetGroup.groupName} (${targetGroup.groupId}).`,
                  exposureSummary: args.cidr
                    ? `${getSecurityGroupDirection(args.action)} rule targets ${args.cidr}.`
                    : `${getSecurityGroupDirection(args.action)} rule targets security group ${sourceGroup?.groupName || sourceGroup?.groupId}.`,
                  confirmationHint: requiredApprovals > 1
                    ? "Reply with 'confirm' to register approval. A distinct second approver is required before execution."
                    : "Reply with 'confirm' to approve and apply this security group change.",
                };

                const approvalRequest = userId
                  ? await upsertApprovalRequest(supabaseAdmin, {
                    requestKey: sgRequestKey,
                    requestHash: sgRequestHash,
                    operationName: "manage_security_group_rule",
                    requesterUserId: userId,
                    summary: preview.summary,
                    riskLevel: risk.riskLevel,
                    requiredApprovals,
                    previewPayload: preview,
                    requestPayload: sgIdempotencyPayload,
                    evidencePayload: {
                      targetGroupId: targetGroup.groupId,
                      groupName: targetGroup.groupName,
                      prodLike: isProdLikeGroup(targetGroup),
                      reasons: risk.reasons,
                    },
                  })
                  : null;

                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "EC2",
                    aws_operation: "previewSecurityGroupRule",
                    aws_region: awsConfig.region,
                    status: "success",
                    validator_result: risk.riskLevel,
                    execution_time_ms: execTime,
                  }).then();
                }

                pushAuditToAws(awsConfig, {
                  timestamp: new Date().toISOString(),
                  userId,
                  service: "EC2",
                  operation: "previewSecurityGroupRule",
                  region: awsConfig.region,
                  status: "preview_only",
                  riskLevel: risk.riskLevel,
                  targetGroupId: targetGroup.groupId,
                  sourceGroupId: sourceGroup?.groupId || null,
                  cidr: args.cidr || null,
                  executionTimeMs: execTime,
                });

                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    ...preview,
                    approval: approvalRequest
                      ? buildApprovalSummaryPayload(
                        approvalRequest,
                        approvalRequest.current_approvals || 0,
                        requiredApprovals,
                        requiredApprovals > 1
                          ? "A distinct second approver is required before execution."
                          : "Reply with 'confirm' to approve and execute.",
                      )
                      : null,
                  }),
                } as any);
                continue;
              }

              if (wouldBeNoop) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    status: "no_op",
                    riskLevel: risk.riskLevel,
                    direction: getSecurityGroupDirection(args.action),
                    operation: operationName,
                    targetGroup,
                    sourceGroup,
                    appliedRule: permission,
                    reason: isAllowAction(args.action)
                      ? "The exact rule already exists."
                      : "No matching rule exists to revoke.",
                  }),
                } as any);
                continue;
              }

              if (!userId) {
                throw new CloudPilotError("Authentication is required for security group approvals.", {
                  code: "AUTH_REQUIRED_FOR_APPROVAL",
                  category: "authentication",
                  status: 401,
                });
              }

              const approvalRequest = await upsertApprovalRequest(supabaseAdmin, {
                requestKey: sgRequestKey,
                requestHash: sgRequestHash,
                operationName: "manage_security_group_rule",
                requesterUserId: userId,
                summary: `${isAllowAction(args.action) ? "Add" : "Remove"} ${getSecurityGroupDirection(args.action)} ${args.protocol}:${args.fromPort}-${args.toPort} on ${targetGroup.groupName} (${targetGroup.groupId}).`,
                riskLevel: risk.riskLevel,
                requiredApprovals,
                previewPayload: {
                  targetGroup,
                  sourceGroup,
                  permission,
                  reasons: risk.reasons,
                },
                requestPayload: sgIdempotencyPayload,
                evidencePayload: {
                  targetGroupId: targetGroup.groupId,
                  groupName: targetGroup.groupName,
                  prodLike: isProdLikeGroup(targetGroup),
                  reasons: risk.reasons,
                },
              });

              await recordApprovalAction(supabaseAdmin, approvalRequest.id, userId);
              const approvalState = await refreshApprovalRequestState(
                supabaseAdmin,
                approvalRequest.id,
                requiredApprovals,
              );

              if (approvalState.approvalCount < requiredApprovals) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    status: "awaiting_additional_approval",
                    riskLevel: risk.riskLevel,
                    direction: getSecurityGroupDirection(args.action),
                    operation: operationName,
                    targetGroup,
                    sourceGroup,
                    requestedRule: {
                      action: args.action,
                      protocol: args.protocol,
                      fromPort: args.fromPort,
                      toPort: args.toPort,
                      cidr: args.cidr || null,
                      sourceGroupId: sourceGroup?.groupId || null,
                    },
                    reasons: risk.reasons,
                    approval: buildApprovalSummaryPayload(
                      approvalState.request,
                      approvalState.approvalCount,
                      requiredApprovals,
                      `A distinct approver must approve this security group change before execution. Current approvals: ${approvalState.approvalCount}/${requiredApprovals}.`,
                    ),
                  }),
                } as any);
                continue;
              }

              const sgClaim = await claimIdempotencyKey(
                supabaseAdmin,
                userId,
                "manage_security_group_rule",
                sgRequestKey,
                sgRequestHash,
              );

              if (sgClaim.existing?.status === "success" && sgClaim.existing.response_payload) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(sgClaim.existing.response_payload),
                } as any);
                continue;
              }

              if (sgClaim.existing?.status === "pending") {
                throw new CloudPilotError("This security group change is already in progress.", {
                  code: "IDEMPOTENT_OPERATION_PENDING",
                  category: "conflict",
                  status: 409,
                });
              }

              if (args.action === "allow_ingress") {
                await withAwsRetry("EC2.authorizeSecurityGroupIngress", () => ec2.authorizeSecurityGroupIngress({
                  GroupId: targetGroup.groupId,
                  IpPermissions: [permission],
                }).promise());
              } else if (args.action === "revoke_ingress") {
                await withAwsRetry("EC2.revokeSecurityGroupIngress", () => ec2.revokeSecurityGroupIngress({
                  GroupId: targetGroup.groupId,
                  IpPermissions: [permission],
                }).promise());
              } else if (args.action === "allow_egress") {
                await withAwsRetry("EC2.authorizeSecurityGroupEgress", () => ec2.authorizeSecurityGroupEgress({
                  GroupId: targetGroup.groupId,
                  IpPermissions: [permission],
                }).promise());
              } else {
                await withAwsRetry("EC2.revokeSecurityGroupEgress", () => ec2.revokeSecurityGroupEgress({
                  GroupId: targetGroup.groupId,
                  IpPermissions: [permission],
                }).promise());
              }

              const finalExecTime = Date.now() - startTime;
              const executionResult = {
                status: "executed",
                riskLevel: risk.riskLevel,
                direction: getSecurityGroupDirection(args.action),
                targetGroup,
                sourceGroup,
                appliedRule: permission,
                operation: operationName,
              };

              await storeIdempotencySuccess(
                supabaseAdmin,
                "manage_security_group_rule",
                sgRequestKey,
                executionResult,
              );
              await markApprovalRequestExecuted(supabaseAdmin, approvalRequest.id, executionResult);

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "EC2",
                  aws_operation: "executeSecurityGroupRule",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: risk.riskLevel,
                  execution_time_ms: finalExecTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "EC2",
                operation: "executeSecurityGroupRule",
                region: awsConfig.region,
                status: "success",
                riskLevel: risk.riskLevel,
                targetGroupId: targetGroup.groupId,
                sourceGroupId: sourceGroup?.groupId || null,
                cidr: args.cidr || null,
                executionTimeMs: finalExecTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(executionResult),
              } as any);
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const typedError = toCloudPilotError(err);
              const errorMessage = typedError.message || "Security group automation failed.";
              if (userHasConfirmedMutation) {
                try {
                  const rawArgs = JSON.parse(toolCall.function.arguments);
                  const args: SecurityGroupRuleArgs = {
                    action: rawArgs.action,
                    targetGroupIdentifier: sanitizeSecurityGroupIdentifier(rawArgs.targetGroupIdentifier),
                    protocol: sanitizeProtocol(rawArgs.protocol),
                    fromPort: normalizePort(rawArgs.fromPort),
                    toPort: normalizePort(rawArgs.toPort),
                    cidr: rawArgs.cidr ? sanitizeCidr(rawArgs.cidr) : undefined,
                    sourceGroupIdentifier: rawArgs.sourceGroupIdentifier
                      ? sanitizeSecurityGroupIdentifier(rawArgs.sourceGroupIdentifier)
                      : undefined,
                    description: rawArgs.description ? sanitizeString(rawArgs.description, 255) : undefined,
                  };
                  const ec2 = v2Client("EC2", awsConfig);
                  const targetGroup = await resolveSecurityGroup(ec2, args.targetGroupIdentifier);
                  const sourceGroup = args.sourceGroupIdentifier
                    ? await resolveSecurityGroup(ec2, args.sourceGroupIdentifier)
                    : null;
                  const permission = buildSecurityGroupPermission(args, sourceGroup?.groupId);
                  const requestHash = await sha256(stableStringify({
                    region: awsConfig.region,
                    action: args.action,
                    targetGroupId: targetGroup.groupId,
                    sourceGroupId: sourceGroup?.groupId || null,
                    cidr: args.cidr || null,
                    permission,
                  }));
                  await storeIdempotencyFailure(
                    supabaseAdmin,
                    "manage_security_group_rule",
                    `security-group:${requestHash}`,
                    { error: errorMessage, code: typedError.code, category: typedError.category },
                  );
                  const { data: approvalRequest } = await supabaseAdmin
                    .from("approval_requests")
                    .select("id")
                    .eq("request_key", `security-group:${requestHash}`)
                    .maybeSingle();
                  if (approvalRequest?.id) {
                    await markApprovalRequestFailed(supabaseAdmin, approvalRequest.id, {
                      error: errorMessage,
                      code: typedError.code,
                      category: typedError.category,
                    });
                  }
                } catch {
                  // Best-effort failure recording only.
                }
              }

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "EC2",
                  aws_operation: "manageSecurityGroupRule",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: typedError.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: "HIGH",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "EC2",
                operation: "manageSecurityGroupRule",
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

          if (toolCall.function.name === "manage_iam_access") {
            const startTime = Date.now();
            try {
              const rawArgs = JSON.parse(toolCall.function.arguments);
              const plan = buildIamAccessPlan(rawArgs);
              const requiredApprovals = requiredApprovalsForIamPlan(plan);
              const idempotencyPayload = {
                region: awsConfig.region,
                principalType: plan.args.principalType,
                principalIdentifier: plan.args.principalIdentifier,
                policyName: plan.policyName,
                policyDocument: plan.policyDocument,
              };
              const iamRequestHash = await sha256(stableStringify(idempotencyPayload));
              const iamRequestKey = `iam-access:${iamRequestHash}`;

              if (!userHasConfirmedMutation) {
                const execTime = Date.now() - startTime;
                const preview = {
                  status: "preview_only",
                  confirmationRequired: true,
                  summary: `Create policy '${plan.policyName}' and attach it to IAM ${plan.args.principalType} '${plan.args.principalIdentifier}'.`,
                  requestedAction: plan.args.action,
                  principal: {
                    type: plan.args.principalType,
                    identifier: plan.args.principalIdentifier,
                  },
                  access: {
                    service: plan.args.service,
                    scope: plan.args.scope,
                    resources: plan.policyDocument.Statement[0].Resource,
                  },
                  operations: [
                    {
                      service: "IAM",
                      operation: "createPolicy",
                    },
                    {
                      service: "IAM",
                      operation: plan.attachOperation,
                    },
                  ],
                  warnings: plan.warnings,
                  policyDocument: plan.policyDocument,
                  confirmationHint: requiredApprovals > 1
                    ? "Reply with 'confirm' to register approval. A distinct second approver is required before execution."
                    : "Reply with 'confirm' to approve and apply this IAM change.",
                };

                const approvalRequest = userId
                  ? await upsertApprovalRequest(supabaseAdmin, {
                    requestKey: iamRequestKey,
                    requestHash: iamRequestHash,
                    operationName: "manage_iam_access",
                    requesterUserId: userId,
                    summary: preview.summary,
                    riskLevel: requiredApprovals > 1 ? "HIGH" : "MEDIUM",
                    requiredApprovals,
                    previewPayload: preview,
                    requestPayload: idempotencyPayload,
                    evidencePayload: {
                      principalType: plan.args.principalType,
                      principalIdentifier: plan.args.principalIdentifier,
                      resources: plan.policyDocument.Statement[0].Resource,
                    },
                  })
                  : null;

                if (userId) {
                  supabaseAdmin.from("agent_audit_log").insert({
                    user_id: userId,
                    aws_service: "IAM",
                    aws_operation: "previewIamAccessChange",
                    aws_region: awsConfig.region,
                    status: "success",
                    validator_result: "ALLOWED",
                    execution_time_ms: execTime,
                  }).then();
                }

                pushAuditToAws(awsConfig, {
                  timestamp: new Date().toISOString(),
                  userId,
                  service: "IAM",
                  operation: "previewIamAccessChange",
                  region: awsConfig.region,
                  principalType: plan.args.principalType,
                  principalIdentifier: plan.args.principalIdentifier,
                  policyName: plan.policyName,
                  status: "preview_only",
                  executionTimeMs: execTime,
                });

                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    ...preview,
                    approval: approvalRequest
                      ? buildApprovalSummaryPayload(
                        approvalRequest,
                        approvalRequest.current_approvals || 0,
                        requiredApprovals,
                        requiredApprovals > 1
                          ? "A distinct second approver is required before execution."
                          : "Reply with 'confirm' to approve and execute.",
                      )
                      : null,
                  }),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any);
                continue;
              }

              if (!userId) {
                throw new CloudPilotError("Authentication is required for IAM approval workflows.", {
                  code: "AUTH_REQUIRED_FOR_APPROVAL",
                  category: "authentication",
                  status: 401,
                });
              }

              const approvalRequest = await upsertApprovalRequest(supabaseAdmin, {
                requestKey: iamRequestKey,
                requestHash: iamRequestHash,
                operationName: "manage_iam_access",
                requesterUserId: userId,
                summary: `Create policy '${plan.policyName}' and attach it to IAM ${plan.args.principalType} '${plan.args.principalIdentifier}'.`,
                riskLevel: requiredApprovals > 1 ? "HIGH" : "MEDIUM",
                requiredApprovals,
                previewPayload: {
                  principalType: plan.args.principalType,
                  principalIdentifier: plan.args.principalIdentifier,
                  policyName: plan.policyName,
                  resources: plan.policyDocument.Statement[0].Resource,
                },
                requestPayload: idempotencyPayload,
                evidencePayload: {
                  principalType: plan.args.principalType,
                  principalIdentifier: plan.args.principalIdentifier,
                  resources: plan.policyDocument.Statement[0].Resource,
                },
              });

              await recordApprovalAction(supabaseAdmin, approvalRequest.id, userId);
              const approvalState = await refreshApprovalRequestState(
                supabaseAdmin,
                approvalRequest.id,
                requiredApprovals,
              );

              if (approvalState.approvalCount < requiredApprovals) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    status: "awaiting_additional_approval",
                    summary: `Create policy '${plan.policyName}' and attach it to IAM ${plan.args.principalType} '${plan.args.principalIdentifier}'.`,
                    principal: {
                      type: plan.args.principalType,
                      identifier: plan.args.principalIdentifier,
                    },
                    policyName: plan.policyName,
                    approval: buildApprovalSummaryPayload(
                      approvalState.request,
                      approvalState.approvalCount,
                      requiredApprovals,
                      `A distinct approver must approve this IAM request before execution. Current approvals: ${approvalState.approvalCount}/${requiredApprovals}.`,
                    ),
                  }),
                } as any);
                continue;
              }

              const iamClaim = await claimIdempotencyKey(
                supabaseAdmin,
                userId,
                "manage_iam_access",
                iamRequestKey,
                iamRequestHash,
              );

              if (iamClaim.existing?.status === "success" && iamClaim.existing.response_payload) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(iamClaim.existing.response_payload),
                } as any);
                continue;
              }

              if (iamClaim.existing?.status === "pending") {
                throw new CloudPilotError("This IAM change is already in progress.", {
                  code: "IDEMPOTENT_OPERATION_PENDING",
                  category: "conflict",
                  status: 409,
                });
              }

              const iam = v2Client("IAM", awsConfig);
              await ensureIamPrincipalExists(iam, plan.args.principalType, plan.args.principalIdentifier);

              const createPolicyResult = await withAwsRetry("IAM.createPolicy", () => iam.createPolicy({
                PolicyName: plan.policyName,
                PolicyDocument: JSON.stringify(plan.policyDocument),
                Description: `Created by CloudPilot IAM automation for ${plan.args.principalType}:${plan.args.principalIdentifier}`,
              }).promise());

              const policyArn = createPolicyResult.Policy?.Arn;
              if (!policyArn) {
                throw new Error("IAM policy was created without a returned ARN.");
              }

              if (plan.args.principalType === "group") {
                await withAwsRetry("IAM.attachGroupPolicy", () => iam.attachGroupPolicy({
                  GroupName: plan.args.principalIdentifier,
                  PolicyArn: policyArn,
                }).promise());
              } else if (plan.args.principalType === "role") {
                await withAwsRetry("IAM.attachRolePolicy", () => iam.attachRolePolicy({
                  RoleName: plan.args.principalIdentifier,
                  PolicyArn: policyArn,
                }).promise());
              } else {
                await withAwsRetry("IAM.attachUserPolicy", () => iam.attachUserPolicy({
                  UserName: plan.args.principalIdentifier,
                  PolicyArn: policyArn,
                }).promise());
              }

              const execTime = Date.now() - startTime;
              const executionResult = {
                status: "executed",
                principal: {
                  type: plan.args.principalType,
                  identifier: plan.args.principalIdentifier,
                },
                policyName: plan.policyName,
                policyArn,
                attachOperation: plan.attachOperation,
                policyDocument: plan.policyDocument,
              };

              await storeIdempotencySuccess(supabaseAdmin, "manage_iam_access", iamRequestKey, executionResult);
              await markApprovalRequestExecuted(supabaseAdmin, approvalRequest.id, executionResult);

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "IAM",
                  aws_operation: "executeIamAccessChange",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "HIGH_RISK",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "IAM",
                operation: "executeIamAccessChange",
                region: awsConfig.region,
                principalType: plan.args.principalType,
                principalIdentifier: plan.args.principalIdentifier,
                policyName: plan.policyName,
                policyArn,
                status: "success",
                validatorResult: "HIGH_RISK",
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(executionResult),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              const execTime = Date.now() - startTime;
              const typedError = toCloudPilotError(err);
              const errorMessage = typedError.message || "IAM automation failed.";
              if (userHasConfirmedMutation) {
                const rawArgs = JSON.parse(toolCall.function.arguments);
                const plan = buildIamAccessPlan(rawArgs);
                const requestHash = await sha256(stableStringify({
                  region: awsConfig.region,
                  principalType: plan.args.principalType,
                  principalIdentifier: plan.args.principalIdentifier,
                  policyName: plan.policyName,
                  policyDocument: plan.policyDocument,
                }));
                await storeIdempotencyFailure(
                  supabaseAdmin,
                  "manage_iam_access",
                  `iam-access:${requestHash}`,
                  { error: errorMessage, code: typedError.code, category: typedError.category },
                );
                const { data: approvalRequest } = await supabaseAdmin
                  .from("approval_requests")
                  .select("id")
                  .eq("request_key", `iam-access:${requestHash}`)
                  .maybeSingle();
                if (approvalRequest?.id) {
                  await markApprovalRequestFailed(supabaseAdmin, approvalRequest.id, {
                    error: errorMessage,
                    code: typedError.code,
                    category: typedError.category,
                  });
                }
              }

              if (userId) {
                supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "IAM",
                  aws_operation: "manageIamAccess",
                  aws_region: awsConfig.region,
                  status: "error",
                  error_code: typedError.code || null,
                  error_message: errorMessage.slice(0, 2000),
                  validator_result: userHasConfirmedMutation ? "HIGH_RISK" : "ALLOWED",
                  execution_time_ms: execTime,
                }).then();
              }

              pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "IAM",
                operation: "manageIamAccess",
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any);
            }
          }

          if (toolCall.function.name === "run_attack_simulation") {
            const startTime = Date.now();
            try {
              const args = JSON.parse(toolCall.function.arguments);

              // Instead of a fake simulation, orchestrate real API calls to map the attack path.
              // We will instruct the agent that it must perform the real checks.
              const simulationResult = {
                simulation_id: `sim_${Date.now()}`,
                target: args.target,
                vector: args.vector,
                status: "orchestrating",
                instructions: `You must now use execute_aws_api to perform real discovery for the '${args.vector}' attack vector against '${args.target}'. Do not use fabricated data. Map out the dynamic attack path using real IAM, EC2, or S3 configurations you retrieve. Calculate the Unified Risk Score based on real findings.`,
              };

              const execTime = Date.now() - startTime;

              if (userId) {
                await supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "SIMULATION",
                  aws_operation: "runAttackSimulation",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                });
              }

              await pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "SIMULATION",
                operation: "runAttackSimulation",
                region: awsConfig.region,
                status: "success",
                target: args.target,
                vector: args.vector,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(simulationResult),
              } as any);
            } catch (err: any) {
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: err.message || "Simulation failed." }),
              } as any);
            }
          }

          if (toolCall.function.name === "run_evasion_test") {
            const startTime = Date.now();
            try {
              const args = JSON.parse(toolCall.function.arguments);

              const evasionResult = {
                test_id: `evasion_${Date.now()}`,
                target_rule: args.detectionRule,
                status: "orchestrating",
                instructions: `You must now use execute_aws_api to query CloudTrail and GuardDuty to check if '${args.detectionRule}' is actively monitoring. Propose specific evasion techniques (like jitter, region-hopping) that could bypass the observed configuration. Do not invent fake detections; verify the real configuration first.`,
              };

              const execTime = Date.now() - startTime;

              if (userId) {
                await supabaseAdmin.from("agent_audit_log").insert({
                  user_id: userId,
                  aws_service: "SIMULATION",
                  aws_operation: "runEvasionTest",
                  aws_region: awsConfig.region,
                  status: "success",
                  validator_result: "ALLOWED",
                  execution_time_ms: execTime,
                });
              }

              await pushAuditToAws(awsConfig, {
                timestamp: new Date().toISOString(),
                userId,
                service: "SIMULATION",
                operation: "runEvasionTest",
                region: awsConfig.region,
                status: "success",
                rule: args.detectionRule,
                executionTimeMs: execTime,
              });

              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(evasionResult),
              } as any);
            } catch (err: any) {
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: err.message || "Evasion test failed." }),
              } as any);
            }
          }

    }

    const results = apiMessages
      .filter((m: any) => m.role === "tool")
      .map((m: any) => ({
        toolCallId: m.tool_call_id,
        content: m.content,
      }));
    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[Ops] Fatal error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

if (import.meta.main) {
  serve(handler);
}
