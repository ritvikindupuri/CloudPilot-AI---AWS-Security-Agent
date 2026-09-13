import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import AWS from "https://esm.sh/aws-sdk@2.1693.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guardian-secret",
};

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const REQUIRED_EVENT_PROCESSOR_ENVS = {
  automationSecret: requireEnv("GUARDIAN_AUTOMATION_WEBHOOK_SECRET"),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
};

const AUTOMATION_SECRET = REQUIRED_EVENT_PROCESSOR_ENVS.automationSecret;
const AWS_REGION_REGEX = /^[a-z]{2}(-[a-z]+-\d+)?$/;
const ACCESS_KEY_REGEX = /^[A-Z0-9]{16,128}$/;
const IPV4_ANYWHERE = "0.0.0.0/0";
const IPV6_ANYWHERE = "::/0";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
type ResponseType = "auto_fix" | "notify" | "runbook" | "all";

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
  risk_level: Severity;
  risk_reason: string;
  requested_ports: number[];
  source_cidrs: string[];
  raw_event: Record<string, any>;
}

interface PolicyRecord {
  id: string;
  policy_id: string;
  name: string;
  trigger_event: string;
  trigger_conditions: Record<string, any>;
  risk_threshold: Severity;
  response_type: ResponseType;
  response_action: string;
  response_params: Record<string, any>;
  notify_channels: string[];
  is_active: boolean;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

const AUTO_FIXABLE_CRITICAL_EVENTS = new Set([
  "DeleteBucketPublicAccessBlock",
  "DeleteBucketEncryption",
  "DeleteTrail",
  "StopLogging",
  "AuthorizeSecurityGroupIngress",
]);

const BUILT_IN_POLICIES: PolicyRecord[] = [
  {
    id: "builtin-auto-block-public-s3",
    policy_id: "auto_block_public_s3",
    name: "Auto-block public S3 access",
    trigger_event: "DeleteBucketPublicAccessBlock",
    trigger_conditions: {},
    risk_threshold: "CRITICAL",
    response_type: "all",
    response_action: "put_public_access_block",
    response_params: { block_all: true },
    notify_channels: ["email"],
    is_active: true,
  },
  {
    id: "builtin-flag-root-usage",
    policy_id: "flag_root_usage",
    name: "Alert on root account usage",
    trigger_event: "*",
    trigger_conditions: { actor_type: "root" },
    risk_threshold: "CRITICAL",
    response_type: "all",
    response_action: "trigger_runbook",
    response_params: { runbook: "root_account_usage_response" },
    notify_channels: ["email"],
    is_active: true,
  },
];

function sanitizeString(val: unknown, maxLen: number): string {
  if (typeof val !== "string") return "";
  return val.slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function buildAwsConfig(credentials: any) {
  const region = sanitizeString(credentials?.region, 30);
  const accessKeyId = sanitizeString(credentials?.accessKeyId, 128);
  const secretAccessKey = sanitizeString(credentials?.secretAccessKey, 256);
  const sessionToken = sanitizeString(credentials?.sessionToken, 2048);
  if (!AWS_REGION_REGEX.test(region)) throw new Error("Invalid AWS region.");
  if (!ACCESS_KEY_REGEX.test(accessKeyId)) throw new Error("Invalid AWS access key.");
  if (!secretAccessKey) throw new Error("Missing AWS secret access key.");
  return {
    region,
    credentials: { accessKeyId, secretAccessKey, sessionToken },
    maxRetries: 4,
    retryDelayOptions: { base: 250 },
  };
}

async function resolveUserId(req: Request, body: any, supabaseAdmin: any): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (user?.id) return user.id;
  }

  const secret = req.headers.get("x-guardian-secret");
  if (AUTOMATION_SECRET && secret === AUTOMATION_SECRET) {
    const userId = sanitizeString(body.userId, 64);
    if (!userId) throw new Error("userId is required when authenticating with the automation secret.");
    return userId;
  }

  throw new Error("Unauthorized event-processor request.");
}

async function getAwsAccountId(awsConfig: any): Promise<string> {
  const sts = new AWS.STS(awsConfig);
  const identity = await sts.getCallerIdentity({}).promise();
  if (!identity.Account) throw new Error("Unable to resolve AWS account ID.");
  return identity.Account;
}

async function ensureAlertTopicAndSubscription(awsConfig: any, notificationEmail: string) {
  const sns = new AWS.SNS(awsConfig);
  const accountId = await getAwsAccountId(awsConfig);
  const topic = await sns.createTopic({ Name: `cloudpilot-alerts-${accountId}` }).promise();
  if (!topic.TopicArn) throw new Error("Failed to create SNS topic.");
  const subscriptions = await sns.listSubscriptionsByTopic({ TopicArn: topic.TopicArn }).promise();
  const existing = (subscriptions.Subscriptions || []).find(
    (subscription) => subscription.Protocol === "email" && subscription.Endpoint === notificationEmail,
  );
  if (!existing) {
    await sns.subscribe({ TopicArn: topic.TopicArn, Protocol: "email", Endpoint: notificationEmail }).promise();
  }
  return topic.TopicArn;
}

async function publishAlert(awsConfig: any, notificationEmail: string | null, subject: string, message: string) {
  if (!notificationEmail) return { sent: false, target: null, note: "No notification email configured." };
  const sns = new AWS.SNS(awsConfig);
  const topicArn = await ensureAlertTopicAndSubscription(awsConfig, notificationEmail);
  const result = await sns.publish({
    TopicArn: topicArn,
    Subject: subject.slice(0, 100),
    Message: message,
  }).promise();
  return { sent: true, target: notificationEmail, topicArn, messageId: result.MessageId || null };
}

function getItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function extractPortsAndCidrs(detail: Record<string, any>) {
  const params = detail.requestParameters || {};
  const ports = new Set<number>();
  const cidrs = new Set<string>();
  for (const permission of getItems(params.ipPermissions)) {
    const fromPort = Number(permission.fromPort);
    const toPort = Number(permission.toPort);
    if (Number.isInteger(fromPort)) ports.add(fromPort);
    if (Number.isInteger(toPort)) ports.add(toPort);
    for (const range of getItems(permission.ipRanges)) if (range?.cidrIp) cidrs.add(String(range.cidrIp));
    for (const range of getItems(permission.ipv6Ranges)) if (range?.cidrIpv6) cidrs.add(String(range.cidrIpv6));
  }
  return { ports: Array.from(ports), cidrs: Array.from(cidrs) };
}

function extractResource(detail: Record<string, any>): [string, string] {
  const eventName = String(detail.eventName || "");
  const params = detail.requestParameters || {};
  switch (eventName) {
    case "AuthorizeSecurityGroupIngress":
    case "AuthorizeSecurityGroupEgress":
    case "RevokeSecurityGroupIngress":
    case "RevokeSecurityGroupEgress":
      return [params.groupId || "unknown", "security_group"];
    case "DeleteBucketPublicAccessBlock":
    case "PutBucketPublicAccessBlock":
    case "PutBucketPolicy":
    case "DeleteBucketPolicy":
    case "DeleteBucketEncryption":
    case "PutBucketEncryption":
    case "PutBucketAcl":
      return [params.bucketName || "unknown", "s3_bucket"];
    case "AttachUserPolicy":
    case "CreateUser":
    case "CreateAccessKey":
    case "DeactivateMFADevice":
      return [params.userName || "unknown", "iam_user"];
    case "DeleteTrail":
    case "StopLogging":
      return [params.name || "unknown", "cloudtrail"];
    default:
      return [params.resourceId || "unknown", "unknown"];
  }
}

function scoreEvent(detail: Record<string, any>, actorType: string, resourceId: string): { level: Severity; reason: string } {
  const eventName = String(detail.eventName || "");
  const { cidrs } = extractPortsAndCidrs(detail);
  const params = detail.requestParameters || {};
  if (actorType === "root") return { level: "CRITICAL", reason: "The root account was used." };
  if (eventName === "AuthorizeSecurityGroupIngress" && (cidrs.includes(IPV4_ANYWHERE) || cidrs.includes(IPV6_ANYWHERE))) {
    return { level: "CRITICAL", reason: "A world-open inbound security group rule was added." };
  }
  if (eventName === "DeleteBucketPublicAccessBlock") {
    return { level: "CRITICAL", reason: "An S3 public access block was removed." };
  }
  if (eventName === "DeleteTrail" || eventName === "StopLogging") {
    return { level: "CRITICAL", reason: "CloudTrail logging was disabled or deleted." };
  }
  if (eventName === "DeactivateMFADevice") {
    return { level: "CRITICAL", reason: "An MFA device was deactivated." };
  }
  if (eventName === "AttachUserPolicy" && JSON.stringify(params).includes("AdministratorAccess")) {
    return { level: "HIGH", reason: "AdministratorAccess was attached to an IAM user." };
  }
  if (eventName === "CreateUser") {
    return { level: "HIGH", reason: "A new IAM user was created." };
  }
  return { level: "MEDIUM", reason: `${eventName} was detected on ${resourceId}.` };
}

function enrichEvent(detail: Record<string, any>): EnrichedEvent {
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
  const [resourceId, resourceType] = extractResource(detail);
  const { level, reason } = scoreEvent(detail, actorType, resourceId);
  const { ports, cidrs } = extractPortsAndCidrs(detail);
  return {
    event_id: String(detail.eventID || crypto.randomUUID()),
    event_name: String(detail.eventName || "Unknown"),
    event_time: String(detail.eventTime || new Date().toISOString()),
    actor_arn: actorArn,
    actor_type: actorType,
    actor_is_guardian: actorIsGuardian,
    source_ip: String(detail.sourceIPAddress || "unknown"),
    resource_id: resourceId,
    resource_type: resourceType,
    region: String(detail.awsRegion || "unknown"),
    risk_level: level,
    risk_reason: reason,
    requested_ports: ports,
    source_cidrs: cidrs,
    raw_event: detail,
  };
}

async function fetchUserPolicies(supabaseAdmin: any, userId: string): Promise<PolicyRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("event_response_policies")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) throw new Error(`Failed to fetch event response policies: ${error.message}`);
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
    is_active: Boolean(row.is_active),
  }));
}

function matchesPolicy(event: EnrichedEvent, policy: PolicyRecord) {
  if (policy.trigger_event !== "*" && policy.trigger_event !== event.event_name) return false;
  if (SEVERITY_ORDER[event.risk_level] > SEVERITY_ORDER[policy.risk_threshold]) return false;
  const conditions = policy.trigger_conditions || {};
  if (conditions.actor_type && conditions.actor_type !== event.actor_type) return false;
  if (typeof conditions.actor_is_guardian === "boolean" && conditions.actor_is_guardian !== event.actor_is_guardian) return false;
  if (conditions.source_cidr && !event.source_cidrs.includes(String(conditions.source_cidr))) return false;
  if (conditions.port && !event.requested_ports.includes(Number(conditions.port))) return false;
  return true;
}

function canAutoFixEvent(event: EnrichedEvent, policy: PolicyRecord) {
  if (event.risk_level !== "CRITICAL") {
    return {
      allowed: false,
      reason: `Auto-fix is restricted to CRITICAL events. This event is ${event.risk_level}.`,
    };
  }
  if (!AUTO_FIXABLE_CRITICAL_EVENTS.has(event.event_name)) {
    return {
      allowed: false,
      reason: `Auto-fix is not enabled for ${event.event_name} because the action is not in the reversible critical allowlist.`,
    };
  }
  return {
    allowed: true,
    reason: null,
  };
}

async function autoFixEvent(awsConfig: any, event: EnrichedEvent) {
  switch (event.event_name) {
    case "DeleteBucketPublicAccessBlock": {
      const s3 = new AWS.S3(awsConfig);
      await s3.putPublicAccessBlock({
        Bucket: event.resource_id,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }).promise();
      return { applied: true, action: "putPublicAccessBlock", resource: event.resource_id };
    }
    case "DeleteBucketEncryption": {
      const s3 = new AWS.S3(awsConfig);
      await s3.putBucketEncryption({
        Bucket: event.resource_id,
        ServerSideEncryptionConfiguration: {
          Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
        },
      }).promise();
      return { applied: true, action: "putBucketEncryption", resource: event.resource_id };
    }
    case "StopLogging":
    case "DeleteTrail": {
      const cloudTrail = new AWS.CloudTrail(awsConfig);
      await cloudTrail.startLogging({ Name: event.resource_id }).promise();
      return { applied: true, action: "startLogging", resource: event.resource_id };
    }
    case "AuthorizeSecurityGroupIngress": {
      const ec2 = new AWS.EC2(awsConfig);
      const params = event.raw_event.requestParameters || {};
      const ipPermissions = getItems(params.ipPermissions).map((permission) => ({
        IpProtocol: permission.ipProtocol,
        FromPort: permission.fromPort,
        ToPort: permission.toPort,
        IpRanges: getItems(permission.ipRanges).map((range) => ({ CidrIp: range.cidrIp, Description: range.description })),
        Ipv6Ranges: getItems(permission.ipv6Ranges).map((range) => ({ CidrIpv6: range.cidrIpv6, Description: range.description })),
      }));
      await ec2.revokeSecurityGroupIngress({ GroupId: params.groupId, IpPermissions: ipPermissions }).promise();
      return { applied: true, action: "revokeSecurityGroupIngress", resource: params.groupId };
    }
    default:
      return { applied: false, note: "No automatic fix is available for this event type." };
  }
}

async function createRunbookExecutionForEvent(supabaseAdmin: any, userId: string, policy: PolicyRecord, event: EnrichedEvent) {
  const runbookId = String(policy.response_params?.runbook || "event_triggered_response");
  const id = crypto.randomUUID();
  await supabaseAdmin.from("runbook_executions").insert({
    id,
    user_id: userId,
    conversation_id: null,
    runbook_id: runbookId,
    runbook_name: runbookId.replace(/_/g, " "),
    trigger_query: `Triggered by ${event.event_name} on ${event.resource_id}`,
    dry_run: false,
    status: "PLANNED",
    current_step_index: 0,
    steps: [],
    results: [{
      status: "TRIGGERED_BY_EVENT",
      event_id: event.event_id,
      event_name: event.event_name,
      event_time: event.event_time,
    }],
    approved_by: null,
    last_error: null,
  });
  return { runbookId, executionId: id };
}

async function recordDriftEvent(supabaseAdmin: any, userId: string, awsConfig: any, event: EnrichedEvent) {
  const accountId = await getAwsAccountId(awsConfig);
  await supabaseAdmin.from("drift_events").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    account_id: accountId,
    region: event.region,
    resource_id: event.resource_id,
    resource_type: event.resource_type,
    change_type: "MODIFIED",
    severity: event.risk_level,
    title: event.risk_reason,
    baseline_state: null,
    current_state: null,
    diff: { cloudtrail_event: event.raw_event },
    explanation: event.risk_reason,
    fix_prompt: `review ${event.event_name} on ${event.resource_id}`,
    resolved: false,
    detected_at: new Date().toISOString(),
  });
}

async function recordEventActivity(
  supabaseAdmin: any,
  userId: string,
  event: EnrichedEvent,
  matchedPolicies: Array<{ id: string; name: string; responseType: string }>,
  autoFixes: any[],
  notifications: any[],
  runbooks: any[],
) {
  await supabaseAdmin.from("guardian_event_activity").insert({
    user_id: userId,
    event_id: event.event_id,
    event_name: event.event_name,
    risk_level: event.risk_level,
    actor_arn: event.actor_arn,
    actor_type: event.actor_type,
    actor_is_guardian: event.actor_is_guardian,
    resource_id: event.resource_id,
    resource_type: event.resource_type,
    region: event.region,
    source_ip: event.source_ip,
    matched_policies: matchedPolicies,
    auto_fixes: autoFixes,
    notifications,
    runbooks,
    raw_event: event.raw_event,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const supabaseAdmin = createClient(
      REQUIRED_EVENT_PROCESSOR_ENVS.supabaseUrl,
      REQUIRED_EVENT_PROCESSOR_ENVS.supabaseServiceRoleKey,
    );
    const userId = await resolveUserId(req, body, supabaseAdmin);
    const awsConfig = buildAwsConfig(body.credentials || {});
    const notificationEmail = sanitizeString(body.notificationEmail || "", 320) || null;
    const detail = body.event?.detail || body.detail || body.event;
    if (!detail || typeof detail !== "object") {
      throw new Error("A CloudTrail event payload is required.");
    }

    const event = enrichEvent(detail);
    if (event.actor_is_guardian) {
      return new Response(JSON.stringify({ status: "skipped", reason: "Guardian-originated event." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPolicies = await fetchUserPolicies(supabaseAdmin, userId);
    const policies = [...BUILT_IN_POLICIES, ...userPolicies].filter((policy) => matchesPolicy(event, policy));

    const notifications: any[] = [];
    const autoFixes: any[] = [];
    const runbooks: any[] = [];

    for (const policy of policies) {
      const autoFixDecision = canAutoFixEvent(event, policy);

      if (policy.response_type === "auto_fix" || policy.response_type === "all") {
        if (autoFixDecision.allowed) {
          autoFixes.push(await autoFixEvent(awsConfig, event));
        } else {
          autoFixes.push({
            applied: false,
            action: policy.response_action,
            resource: event.resource_id,
            skipped: true,
            reason: autoFixDecision.reason,
          });
        }
      }
      if (policy.response_type === "notify" || policy.response_type === "all") {
        notifications.push(await publishAlert(
          awsConfig,
          notificationEmail,
          `CloudPilot event alert: ${event.event_name}`,
          `${event.risk_level} event detected.\n\nEvent: ${event.event_name}\nResource: ${event.resource_id}\nActor: ${event.actor_arn}\nReason: ${event.risk_reason}\nTime: ${event.event_time}`,
        ));
      }
      if (policy.response_type === "runbook" || policy.response_type === "all") {
        runbooks.push(await createRunbookExecutionForEvent(supabaseAdmin, userId, policy, event));
      }
    }

    await recordDriftEvent(supabaseAdmin, userId, awsConfig, event);
    const matchedPolicySummaries = policies.map((policy) => ({
      id: policy.policy_id,
      name: policy.name,
      responseType: policy.response_type,
    }));
    await recordEventActivity(
      supabaseAdmin,
      userId,
      event,
      matchedPolicySummaries,
      autoFixes,
      notifications,
      runbooks,
    );
    await supabaseAdmin.from("agent_audit_log").insert({
      user_id: userId,
      aws_service: "CLOUDTRAIL",
      aws_operation: "processEvent",
      aws_region: awsConfig.region,
      status: "success",
      validator_result: event.risk_level,
      execution_time_ms: 0,
    });

    return new Response(JSON.stringify({
      status: "processed",
      event,
      matchedPolicies: matchedPolicySummaries,
      autoFixes,
      notifications,
      runbooks,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const status = String(error?.message || "").startsWith("Missing required environment variable") ? 500 : 400;
    return new Response(JSON.stringify({
      error: error?.message || "Event processing failed.",
      category: status === 500 ? "configuration" : "validation",
    }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
