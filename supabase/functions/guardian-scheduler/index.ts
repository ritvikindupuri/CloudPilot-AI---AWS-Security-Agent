import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import AWS from "https://esm.sh/aws-sdk@2.1693.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// SECURITY HARDENING: Strict CORS origin validation with allowlist
const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:5173",
  ...(Deno.env.get("ALLOWED_ORIGINS") || "").split(",").filter(Boolean),
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) 
    ? origin 
    : (Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080");
  
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guardian-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

function requireEnv(name: string, allowEmpty = false): string {
  const value = Deno.env.get(name);
  if (!allowEmpty && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || "";
}

const REQUIRED_SCHEDULER_ENVS = {
  automationSecret: requireEnv("GUARDIAN_AUTOMATION_WEBHOOK_SECRET"),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
};

const AUTOMATION_SECRET = REQUIRED_SCHEDULER_ENVS.automationSecret;
const AWS_REGION_REGEX = /^[a-z]{2}(-[a-z]+-\d+)?$/;
const ACCESS_KEY_REGEX = /^[A-Z0-9]{16,128}$/;

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
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
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

  throw new Error("Unauthorized scheduler request.");
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
  const topicName = `cloudpilot-alerts-${accountId}`;
  const topic = await sns.createTopic({ Name: topicName }).promise();
  const topicArn = topic.TopicArn;
  if (!topicArn) throw new Error("Failed to create SNS topic for alerts.");

  const subscriptions = await sns.listSubscriptionsByTopic({ TopicArn: topicArn }).promise();
  const existing = (subscriptions.Subscriptions || []).find(
    (subscription) => subscription.Protocol === "email" && subscription.Endpoint === notificationEmail,
  );

  if (!existing) {
    await sns.subscribe({
      TopicArn: topicArn,
      Protocol: "email",
      Endpoint: notificationEmail,
    }).promise();
  }

  return topicArn;
}

async function publishAlert(awsConfig: any, notificationEmail: string | null | undefined, subject: string, message: string) {
  if (!notificationEmail) {
    return { sent: false, target: null, note: "No notification email configured." };
  }
  const sns = new AWS.SNS(awsConfig);
  const topicArn = await ensureAlertTopicAndSubscription(awsConfig, notificationEmail);
  const result = await sns.publish({
    TopicArn: topicArn,
    Subject: subject.slice(0, 100),
    Message: message,
  }).promise();
  return { sent: true, target: notificationEmail, topicArn, messageId: result.MessageId || null };
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

async function fetchCostRules(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("cost_automation_rules")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to fetch cost automation rules: ${error.message}`);
  return data || [];
}

function parseCostResponse(response: any) {
  const results: Array<{ date: string; label: string; amount: number; unit: string }> = [];
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

async function fetchCostData(awsConfig: any, daysBack = 14) {
  const ce = new AWS.CostExplorer(awsConfig);
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const toDay = (value: Date) => value.toISOString().slice(0, 10);

  const daily = await ce.getCostAndUsage({
    TimePeriod: { Start: toDay(start), End: toDay(end) },
    Granularity: "DAILY",
    Metrics: ["UnblendedCost"],
    GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
  }).promise();

  return {
    daily_by_service: parseCostResponse(daily),
    period: { start: toDay(start), end: toDay(end) },
  };
}

function detectCostAnomalies(dailySpend: Array<{ date: string; label: string; amount: number }>, rules: any[]) {
  const anomalies: any[] = [];
  const byService: Record<string, Array<{ date: string; amount: number }>> = {};
  const byDate: Record<string, number> = {};

  for (const entry of dailySpend) {
    byService[entry.label] ||= [];
    byService[entry.label].push(entry);
    byDate[entry.date] = (byDate[entry.date] || 0) + entry.amount;
  }
  for (const entries of Object.values(byService)) entries.sort((a, b) => a.date.localeCompare(b.date));

  const latestDate = Object.keys(byDate).sort().slice(-1)[0];
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
          today: Number(today.toFixed(2)),
          mean: Number(mean.toFixed(2)),
          z_score: Number(zScore.toFixed(2)),
          severity: zScore > 4 ? "CRITICAL" : "HIGH",
        });
      }
    }
  }

  for (const rule of rules) {
    if (rule.rule_type === "daily_threshold" && typeof rule.threshold === "number" && totalToday > Number(rule.threshold)) {
      anomalies.push({
        type: "threshold_breach",
        service: String(rule.scope || "total"),
        threshold: Number(rule.threshold),
        actual: Number(totalToday.toFixed(2)),
        severity: "HIGH",
      });
    }
  }

  return anomalies;
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

function summarizeTags(tags: AWS.EC2.TagList | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags || []) {
    if (tag.Key && tag.Value) out[tag.Key.toLowerCase()] = tag.Value.toLowerCase();
  }
  return out;
}

async function findIdleEc2Instances(awsConfig: any, thresholdCpu = 2.0, lookbackHours = 24) {
  const ec2 = new AWS.EC2(awsConfig);
  const cloudWatch = new AWS.CloudWatch(awsConfig);
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
          hourly_cost: INSTANCE_HOURLY_COST_HINTS[instance.InstanceType || ""] || 0,
        });
      }
    }
  }

  return idle;
}

function normalizeJson(value: any): any {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalizeJson(v)]));
  }
  return value;
}

async function computeFingerprint(state: Record<string, any>) {
  const normalized = JSON.stringify(normalizeJson(state), (_key, value) => value instanceof Date ? value.toISOString() : value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function buildSnapshot(resourceType: string, resourceId: string, accountId: string, region: string, state: Record<string, any>) {
  return {
    resource_id: resourceId,
    resource_type: resourceType,
    account_id: accountId,
    region,
    state,
    fingerprint: await computeFingerprint(state),
    captured_at: new Date().toISOString(),
  };
}

async function captureSecurityGroupSnapshots(awsConfig: any, accountId: string) {
  const ec2 = new AWS.EC2(awsConfig);
  const response = await ec2.describeSecurityGroups({ MaxResults: 1000 }).promise();
  const snapshots = [];
  for (const sg of response.SecurityGroups || []) {
    if (!sg.GroupId) continue;
    snapshots.push(await buildSnapshot("security_group", sg.GroupId, accountId, awsConfig.region, {
      name: sg.GroupName || sg.GroupId,
      ingress_rules: sg.IpPermissions || [],
      egress_rules: sg.IpPermissionsEgress || [],
      tags: Object.fromEntries((sg.Tags || []).filter((tag) => tag.Key).map((tag) => [String(tag.Key), tag.Value || ""])),
      vpc_id: sg.VpcId || null,
    }));
  }
  return snapshots;
}

async function captureIamUserSnapshots(awsConfig: any, accountId: string) {
  const iam = new AWS.IAM(awsConfig);
  const response = await iam.listUsers({ MaxItems: 1000 }).promise();
  const snapshots = [];
  for (const user of response.Users || []) {
    if (!user.UserName) continue;
    const [policies, mfa, keys] = await Promise.all([
      iam.listAttachedUserPolicies({ UserName: user.UserName, MaxItems: 1000 }).promise(),
      iam.listMFADevices({ UserName: user.UserName }).promise(),
      iam.listAccessKeys({ UserName: user.UserName }).promise(),
    ]);
    snapshots.push(await buildSnapshot("iam_user", user.UserName, accountId, awsConfig.region, {
      attached_policies: (policies.AttachedPolicies || []).map((policy) => policy.PolicyName || policy.PolicyArn || "unknown"),
      mfa_enabled: (mfa.MFADevices || []).length > 0,
      access_keys: (keys.AccessKeyMetadata || []).map((key) => ({
        id: key.AccessKeyId || "",
        status: key.Status || "Unknown",
        created: toIsoString(key.CreateDate),
      })),
      created: toIsoString(user.CreateDate),
    }));
  }
  return snapshots;
}

async function captureS3BucketSnapshots(awsConfig: any, accountId: string) {
  const s3 = new AWS.S3(awsConfig);
  const response = await s3.listBuckets().promise();
  const snapshots = [];
  for (const bucket of response.Buckets || []) {
    if (!bucket.Name) continue;
    const bucketName = bucket.Name;
    let publicAccessBlock = null;
    let encryptionRules = null;
    let versioning = "Unknown";
    try {
      const pub = await s3.getPublicAccessBlock({ Bucket: bucketName }).promise();
      publicAccessBlock = pub.PublicAccessBlockConfiguration || null;
    } catch { /* noop */ }
    try {
      const enc = await s3.getBucketEncryption({ Bucket: bucketName }).promise();
      encryptionRules = enc.ServerSideEncryptionConfiguration?.Rules || null;
    } catch { /* noop */ }
    try {
      const ver = await s3.getBucketVersioning({ Bucket: bucketName }).promise();
      versioning = ver.Status || "Disabled";
    } catch { /* noop */ }
    snapshots.push(await buildSnapshot("s3_bucket", bucketName, accountId, awsConfig.region, {
      public_access_block: publicAccessBlock,
      encryption: encryptionRules,
      versioning,
    }));
  }
  return snapshots;
}

function computeStructuredDiff(baselineState: Record<string, any>, currentState: Record<string, any>) {
  const diff: Record<string, { before: any; after: any }> = {};
  const keys = new Set([...Object.keys(baselineState || {}), ...Object.keys(currentState || {})]);
  for (const key of keys) {
    const before = baselineState?.[key];
    const after = currentState?.[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) diff[key] = { before, after };
  }
  return diff;
}

function hasWorldOpenRule(rules: any[] | undefined) {
  for (const rule of rules || []) {
    for (const range of rule?.IpRanges || []) if (range?.CidrIp === "0.0.0.0/0") return true;
    for (const range of rule?.Ipv6Ranges || []) if (range?.CidrIpv6 === "::/0") return true;
  }
  return false;
}

function isPublicAccessBlockMissingOrDisabled(value: any) {
  if (!value) return true;
  return ![value.BlockPublicAcls, value.IgnorePublicAcls, value.BlockPublicPolicy, value.RestrictPublicBuckets].every(Boolean);
}

function scoreDrift(resourceType: string, changeType: string, resourceId: string, diff: Record<string, any>) {
  let severity = "LOW";
  let title = `${resourceType} configuration changed`;
  let fixPrompt = `show me changes to ${resourceId}`;
  if (resourceType === "security_group" && changeType === "MODIFIED" && hasWorldOpenRule(diff.ingress_rules?.after)) {
    severity = "CRITICAL";
    title = "World-open inbound rule added to security group";
    fixPrompt = `remove world-open rule from ${resourceId}`;
  } else if (resourceType === "s3_bucket" && changeType === "MODIFIED" && isPublicAccessBlockMissingOrDisabled(diff.public_access_block?.after)) {
    severity = "CRITICAL";
    title = "S3 public access block removed";
    fixPrompt = `block all public access on ${resourceId}`;
  } else if (resourceType === "iam_user" && changeType === "MODIFIED" && JSON.stringify(diff.attached_policies?.after || []).includes("AdministratorAccess")) {
    severity = "HIGH";
    title = "AdministratorAccess policy attached to IAM user";
    fixPrompt = `review admin access for ${resourceId}`;
  } else if (resourceType === "iam_user" && changeType === "MODIFIED" && diff.mfa_enabled?.after === false) {
    severity = "HIGH";
    title = "MFA disabled on IAM user";
    fixPrompt = `re-enable MFA for ${resourceId}`;
  } else if (resourceType === "s3_bucket" && changeType === "MODIFIED" && diff.versioning?.after === "Disabled") {
    severity = "MEDIUM";
    title = "Versioning disabled on S3 bucket";
    fixPrompt = `re-enable versioning on ${resourceId}`;
  }
  return { severity, title, fixPrompt };
}

async function runDriftScan(supabaseAdmin: any, userId: string, awsConfig: any) {
  const accountId = await getAwsAccountId(awsConfig);
  const [sg, iam, s3] = await Promise.all([
    captureSecurityGroupSnapshots(awsConfig, accountId),
    captureIamUserSnapshots(awsConfig, accountId),
    captureS3BucketSnapshots(awsConfig, accountId),
  ]);
  const currentSnapshots = [...sg, ...iam, ...s3];

  const { data: baselineRows, error } = await supabaseAdmin
    .from("resource_snapshots")
    .select("*")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .eq("is_baseline", true);
  if (error) throw new Error(`Failed to fetch baseline snapshots: ${error.message}`);
  const baselines = new Map<string, any>();
  for (const row of baselineRows || []) baselines.set(`${row.resource_type}:${row.resource_id}`, row);

  const currentIds = new Set<string>();
  const events: any[] = [];

  for (const snapshot of currentSnapshots) {
    const key = `${snapshot.resource_type}:${snapshot.resource_id}`;
    currentIds.add(key);
    const baseline = baselines.get(key);
    if (!baseline) continue;
    if (snapshot.fingerprint !== baseline.fingerprint) {
      const diff = computeStructuredDiff(baseline.state || {}, snapshot.state);
      if (Object.keys(diff).length === 0) continue;
      const scored = scoreDrift(snapshot.resource_type, "MODIFIED", snapshot.resource_id, diff);
      events.push({
        id: crypto.randomUUID(),
        user_id: userId,
        account_id: accountId,
        region: snapshot.region,
        resource_id: snapshot.resource_id,
        resource_type: snapshot.resource_type,
        change_type: "MODIFIED",
        severity: scored.severity,
        title: scored.title,
        baseline_state: baseline.state || null,
        current_state: snapshot.state,
        diff,
        explanation: `${snapshot.resource_id} differs from the stored baseline and requires review.`,
        fix_prompt: scored.fixPrompt,
        resolved: false,
        detected_at: new Date().toISOString(),
      });
    }
  }

  if (events.length > 0) {
    const { error: insertError } = await supabaseAdmin.from("drift_events").insert(events);
    if (insertError) throw new Error(`Failed to persist drift events: ${insertError.message}`);
  }

  return { accountId, snapshotCount: currentSnapshots.length, driftEvents: events };
}

// ── AES-256-GCM Encryption helpers for stored credentials ──────────────────
// Key derivation: PBKDF2 from service role key + user-specific salt
// Matches the aws-credential-vault edge function encryption scheme.

async function deriveDecryptionKey(userId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(REQUIRED_SCHEDULER_ENVS.supabaseServiceRoleKey),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(`cloudpilot-vault-${userId}`),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptValue(encryptedB64: string, userId: string): Promise<string> {
  try {
    const key = await deriveDecryptionKey(userId);
    const combined = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("Failed to decrypt stored credential value. Credentials may need re-encryption.");
  }
}

// ── Autonomous mode: fetch all stored credentials and scan each ─────────────
async function runAutonomousScans(supabaseAdmin: any): Promise<any[]> {
  const { data: storedCreds, error } = await supabaseAdmin
    .from("stored_aws_credentials")
    .select("*")
    .eq("guardian_enabled", true);

  if (error) {
    throw new Error(`Failed to fetch stored credentials: ${error.message}`);
  }

  if (!storedCreds || storedCreds.length === 0) {
    return [{ status: "no_credentials", message: "No stored credentials with Guardian enabled." }];
  }

  const scanResults: any[] = [];

  for (const cred of storedCreds) {
    const scanStart = Date.now();
    try {
      const accessKeyId = await decryptValue(cred.encrypted_access_key_id, cred.user_id);
      const secretAccessKey = await decryptValue(cred.encrypted_secret_access_key, cred.user_id);
      const sessionToken = cred.encrypted_session_token
        ? await decryptValue(cred.encrypted_session_token, cred.user_id)
        : undefined;

      const awsConfig = buildAwsConfig({
        region: cred.region,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      });

      const mode = cred.scan_mode || "all";
      const notificationEmail = cred.notification_email || null;
      const userResult: Record<string, any> = {
        userId: cred.user_id,
        label: cred.label,
        accountId: cred.account_id,
        mode,
      };

      if (mode === "cost" || mode === "all") {
        const rules = await fetchCostRules(supabaseAdmin, cred.user_id);
        const costData = await fetchCostData(awsConfig, 14);
        const anomalies = detectCostAnomalies(costData.daily_by_service, rules);
        const idleInstances = await findIdleEc2Instances(awsConfig);
        let notification = null;
        if (anomalies.length > 0) {
          notification = await publishAlert(
            awsConfig,
            notificationEmail,
            "CloudPilot scheduled cost alert",
            `Cost anomalies detected: ${anomalies.map((item: any) => `${item.service} (${item.severity})`).join(", ")}.`,
          );
        }
        userResult.cost = {
          anomalyCount: anomalies.length,
          anomalies,
          idleInstanceCount: idleInstances.length,
          notification,
        };
      }

      if (mode === "drift" || mode === "all") {
        const drift = await runDriftScan(supabaseAdmin, cred.user_id, awsConfig);
        let notification = null;
        if (drift.driftEvents.length > 0) {
          notification = await publishAlert(
            awsConfig,
            notificationEmail,
            "CloudPilot scheduled drift alert",
            `Drift scan detected ${drift.driftEvents.length} change(s). Highest finding: ${drift.driftEvents[0]?.title || "configuration drift"}.`,
          );
        }
        userResult.drift = {
          driftCount: drift.driftEvents.length,
          notification,
        };
      }

      await supabaseAdmin.from("agent_audit_log").insert({
        user_id: cred.user_id,
        aws_service: "MULTI",
        aws_operation: "autonomousScheduledScan",
        aws_region: cred.region,
        status: "success",
        validator_result: "ALLOWED",
        execution_time_ms: Date.now() - scanStart,
      });

      // Update last scan timestamp
      await supabaseAdmin
        .from("stored_aws_credentials")
        .update({ last_scan_at: new Date().toISOString(), last_scan_status: "success", updated_at: new Date().toISOString() })
        .eq("id", cred.id);

      userResult.status = "success";
      scanResults.push(userResult);
    } catch (scanErr: any) {
      console.error(`[Guardian] Autonomous scan failed for user ${cred.user_id}:`, scanErr.message);

      await supabaseAdmin
        .from("stored_aws_credentials")
        .update({ last_scan_at: new Date().toISOString(), last_scan_status: `failed: ${scanErr.message?.slice(0, 200)}`, updated_at: new Date().toISOString() })
        .eq("id", cred.id);

      await supabaseAdmin.from("agent_audit_log").insert({
        user_id: cred.user_id,
        aws_service: "MULTI",
        aws_operation: "autonomousScheduledScan",
        aws_region: cred.region,
        status: "error",
        error_message: scanErr.message?.slice(0, 500),
        validator_result: "ALLOWED",
        execution_time_ms: Date.now() - scanStart,
      });

      scanResults.push({
        userId: cred.user_id,
        label: cred.label,
        status: "failed",
        error: scanErr.message,
      });
    }
  }

  return scanResults;
}

async function recordAutomationRun(
  supabaseAdmin: any,
  userId: string,
  source: string,
  mode: string,
  status: string,
  accountId: string | null,
  summary: Record<string, any>,
) {
  await supabaseAdmin.from("automation_runs").insert({
    user_id: userId,
    source,
    mode,
    status,
    account_id: accountId,
    summary,
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabaseAdmin = createClient(
      REQUIRED_SCHEDULER_ENVS.supabaseUrl,
      REQUIRED_SCHEDULER_ENVS.supabaseServiceRoleKey,
    );

    // ── Rate limiting via token bucket in rate_limit_entries table ──
    const rateLimitKey = `guardian-scheduler:${body.userId || "autonomous"}`;
    const windowMinutes = 5;
    const maxRequests = 10;
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

    const { data: rlEntry } = await supabaseAdmin
      .from("rate_limit_entries")
      .select("*")
      .eq("key", rateLimitKey)
      .gte("window_start", windowStart.toISOString())
      .maybeSingle();

    if (rlEntry && rlEntry.request_count >= maxRequests) {
      return new Response(JSON.stringify({
        error: "Rate limit exceeded. Max 10 requests per 5 minutes.",
        retryAfter: windowMinutes * 60,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(windowMinutes * 60) },
      });
    }

    if (rlEntry) {
      await supabaseAdmin
        .from("rate_limit_entries")
        .update({ request_count: rlEntry.request_count + 1 })
        .eq("id", rlEntry.id);
    } else {
      await supabaseAdmin
        .from("rate_limit_entries")
        .insert({ key: rateLimitKey, request_count: 1, window_start: now.toISOString() });
    }

    // ── Autonomous mode: pg_cron invocation with no credentials in body ──
    const isAutonomous = !body.credentials && (
      req.headers.get("x-guardian-secret") === AUTOMATION_SECRET ||
      body.autonomous === true
    );

    if (isAutonomous) {
      console.log("[Guardian] Autonomous scan triggered — processing all stored credentials.");
      const scanResults = await runAutonomousScans(supabaseAdmin);
      return new Response(JSON.stringify({
        mode: "autonomous",
        scansProcessed: scanResults.length,
        results: scanResults,
        generatedAt: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Manual mode: existing single-user credential flow ──
    const userId = await resolveUserId(req, body, supabaseAdmin);
    const awsConfig = buildAwsConfig(body.credentials || {});
    const mode = sanitizeString(body.mode || "all", 32).toLowerCase();
    const notificationEmail = sanitizeString(body.notificationEmail || "", 320) || null;
    const results: Record<string, any> = {
      mode,
      generatedAt: new Date().toISOString(),
    };

    if (mode === "cost" || mode === "all") {
      const rules = await fetchCostRules(supabaseAdmin, userId);
      const costData = await fetchCostData(awsConfig, Number(body.daysBack || 14));
      const anomalies = detectCostAnomalies(costData.daily_by_service, rules);
      const idleInstances = await findIdleEc2Instances(awsConfig);
      let notification = null;
      if (anomalies.length > 0) {
        notification = await publishAlert(
          awsConfig,
          notificationEmail,
          "CloudPilot scheduled cost alert",
          `Cost anomalies detected: ${anomalies.map((item) => `${item.service} (${item.severity})`).join(", ")}.`,
        );
      }
      results.cost = {
        period: costData.period,
        anomalyCount: anomalies.length,
        anomalies,
        idleInstances,
        notification,
      };
    }

    if (mode === "drift" || mode === "all") {
      const drift = await runDriftScan(supabaseAdmin, userId, awsConfig);
      let notification = null;
      if (drift.driftEvents.length > 0) {
        notification = await publishAlert(
          awsConfig,
          notificationEmail,
          "CloudPilot scheduled drift alert",
          `Drift scan detected ${drift.driftEvents.length} change(s). Highest finding: ${drift.driftEvents[0]?.title || "configuration drift"}.`,
        );
      }
      results.drift = {
        accountId: drift.accountId,
        snapshotCount: drift.snapshotCount,
        driftCount: drift.driftEvents.length,
        events: drift.driftEvents,
        notification,
      };
    }

    const schedulerAccountId =
      results.drift?.accountId ||
      body.accountId ||
      null;

    await recordAutomationRun(
      supabaseAdmin,
      userId,
      "guardian-scheduler",
      mode,
      "success",
      schedulerAccountId,
      {
        generatedAt: results.generatedAt,
        cost: results.cost
          ? {
              anomalyCount: results.cost.anomalyCount,
              idleInstanceCount: Array.isArray(results.cost.idleInstances) ? results.cost.idleInstances.length : 0,
              notificationSent: Boolean(results.cost.notification?.sent),
            }
          : null,
        drift: results.drift
          ? {
              snapshotCount: results.drift.snapshotCount,
              driftCount: results.drift.driftCount,
              notificationSent: Boolean(results.drift.notification?.sent),
            }
          : null,
      },
    );

    await supabaseAdmin.from("agent_audit_log").insert({
      user_id: userId,
      aws_service: "MULTI",
      aws_operation: "scheduledAutomationRun",
      aws_region: awsConfig.region,
      status: "success",
      validator_result: "ALLOWED",
      execution_time_ms: 0,
    });

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const status = String(error?.message || "").startsWith("Missing required environment variable") ? 500 : 400;
    return new Response(JSON.stringify({
      error: error?.message || "Scheduler execution failed.",
      category: status === 500 ? "configuration" : "validation",
    }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
