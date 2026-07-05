import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── AWS SDK v3 Dynamic Module Loader ────────────────────────────────────────
const _awsModuleCache: Record<string, any> = {};

const _awsSvcMap: Record<string, string> = {
  IAM: "iam", EC2: "ec2", S3: "s3", STS: "sts",
  Organizations: "organizations", CloudWatch: "cloudwatch",
  CostExplorer: "cost-explorer", SNS: "sns",
  CloudTrail: "cloudtrail", CloudWatchLogs: "cloudwatch-logs",
  GuardDuty: "guardduty", SecurityHub: "securityhub",
  Config: "config-service", RDS: "rds", Lambda: "lambda",
  EKS: "eks", ECS: "ecs", KMS: "kms",
  SecretsManager: "secrets-manager", SSM: "ssm",
  WAFv2: "wafv2", CloudFront: "cloudfront", SQS: "sqs",
  ECR: "ecr", Athena: "athena", Inspector2: "inspector2",
  AccessAnalyzer: "accessanalyzer", Macie2: "macie2",
  NetworkFirewall: "network-firewall", Shield: "shield",
  ACM: "acm", APIGateway: "api-gateway",
  CognitoIdentityServiceProvider: "cognito-identity-provider",
  EventBridge: "eventbridge", StepFunctions: "sfn",
  ElastiCache: "elasticache", Redshift: "redshift",
  DynamoDB: "dynamodb", Route53: "route53",
  ELBv2: "elastic-load-balancing-v2", AutoScaling: "auto-scaling",
  ElasticLoadBalancingV2: "elastic-load-balancing-v2",
  ElasticLoadBalancing: "elastic-load-balancing",
  ConfigService: "config-service", SES: "ses",
  ApiGateway: "api-gateway", WAFV2: "wafv2",
  Budgets: "budgets",
};

const V3_CLIENT_NAMES: Record<string, string> = {
  IAM: "IAMClient", EC2: "EC2Client", S3: "S3Client", STS: "STSClient",
  Organizations: "OrganizationsClient", CloudWatch: "CloudWatchClient",
  CostExplorer: "CostExplorerClient", SNS: "SNSClient", CloudTrail: "CloudTrailClient",
  CloudWatchLogs: "CloudWatchLogsClient", GuardDuty: "GuardDutyClient",
  SecurityHub: "SecurityHubClient", Config: "ConfigServiceClient",
  RDS: "RDSClient", Lambda: "LambdaClient", EKS: "EKSClient", ECS: "ECSClient",
  KMS: "KMSClient", SecretsManager: "SecretsManagerClient", SSM: "SSMClient",
  WAFv2: "WAFv2Client", CloudFront: "CloudFrontClient", SQS: "SQSClient",
  ECR: "ECRClient", Athena: "AthenaClient", Inspector2: "Inspector2Client",
  AccessAnalyzer: "AccessAnalyzerClient", Macie2: "Macie2Client",
  NetworkFirewall: "NetworkFirewallClient", Shield: "ShieldClient",
  ACM: "ACMClient", APIGateway: "APIGatewayClient",
  CognitoIdentityServiceProvider: "CognitoIdentityProviderClient",
  EventBridge: "EventBridgeClient", StepFunctions: "SFNClient",
  ElastiCache: "ElastiCacheClient", Redshift: "RedshiftClient",
  DynamoDB: "DynamoDBClient", Route53: "Route53Client",
  ELBv2: "ElasticLoadBalancingV2Client", AutoScaling: "AutoScalingClient",
  ElasticLoadBalancingV2: "ElasticLoadBalancingV2Client",
  ElasticLoadBalancing: "ElasticLoadBalancingClient",
  ConfigService: "ConfigServiceClient", SES: "SESClient",
  ApiGateway: "APIGatewayClient", WAFV2: "WAFV2Client",
  Budgets: "BudgetsClient",
};

async function loadAwsModule(service: string): Promise<any> {
  if (_awsModuleCache[service]) return _awsModuleCache[service];
  const pkg = _awsSvcMap[service];
  if (!pkg) throw new Error(`Unsupported AWS service: ${service}`);
  const specifier = "npm:@aws-sdk/client-" + pkg;
  const mod = await import(specifier);
  _awsModuleCache[service] = mod;
  return mod;
}

// ── Auto-Elevation: attach the right AWS-managed policy on AccessDenied ───
// Maps the AWS service (as named in our executor) to the AWS-managed policy
// ARN that grants the permissions needed for that service. We deliberately
// pick "FullAccess" managed policies so the retry succeeds for any action
// the agent might call against that service.
const SERVICE_TO_MANAGED_POLICY: Record<string, string> = {
  EC2: "arn:aws:iam::aws:policy/AmazonEC2FullAccess",
  S3: "arn:aws:iam::aws:policy/AmazonS3FullAccess",
  IAM: "arn:aws:iam::aws:policy/IAMFullAccess",
  CloudWatch: "arn:aws:iam::aws:policy/CloudWatchFullAccess",
  CloudWatchLogs: "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
  CloudTrail: "arn:aws:iam::aws:policy/AWSCloudTrail_FullAccess",
  GuardDuty: "arn:aws:iam::aws:policy/AmazonGuardDutyFullAccess",
  SecurityHub: "arn:aws:iam::aws:policy/AWSSecurityHubFullAccess",
  Config: "arn:aws:iam::aws:policy/AWS_ConfigRole",
  RDS: "arn:aws:iam::aws:policy/AmazonRDSFullAccess",
  Lambda: "arn:aws:iam::aws:policy/AWSLambda_FullAccess",
  ECS: "arn:aws:iam::aws:policy/AmazonECS_FullAccess",
  EKS: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
  KMS: "arn:aws:iam::aws:policy/AWSKeyManagementServicePowerUser",
  SecretsManager: "arn:aws:iam::aws:policy/SecretsManagerReadWrite",
  SSM: "arn:aws:iam::aws:policy/AmazonSSMFullAccess",
  SNS: "arn:aws:iam::aws:policy/AmazonSNSFullAccess",
  SQS: "arn:aws:iam::aws:policy/AmazonSQSFullAccess",
  DynamoDB: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
  Organizations: "arn:aws:iam::aws:policy/AWSOrganizationsFullAccess",
  CostExplorer: "arn:aws:iam::aws:policy/AWSBillingReadOnlyAccess",
  WAFv2: "arn:aws:iam::aws:policy/AWSWAFFullAccess",
  CloudFront: "arn:aws:iam::aws:policy/CloudFrontFullAccess",
  ECR: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess",
  Route53: "arn:aws:iam::aws:policy/AmazonRoute53FullAccess",
  ELBv2: "arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess",
  ElasticLoadBalancingV2: "arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess",
  ElasticLoadBalancing: "arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess",
  AutoScaling: "arn:aws:iam::aws:policy/AutoScalingFullAccess",
  EventBridge: "arn:aws:iam::aws:policy/AmazonEventBridgeFullAccess",
  StepFunctions: "arn:aws:iam::aws:policy/AWSStepFunctionsFullAccess",
  ElastiCache: "arn:aws:iam::aws:policy/AmazonElastiCacheFullAccess",
  Redshift: "arn:aws:iam::aws:policy/AmazonRedshiftFullAccess",
  AccessAnalyzer: "arn:aws:iam::aws:policy/IAMAccessAnalyzerFullAccess",
  Inspector2: "arn:aws:iam::aws:policy/AmazonInspector2FullAccess",
  Macie2: "arn:aws:iam::aws:policy/AmazonMacieFullAccess",
  Athena: "arn:aws:iam::aws:policy/AmazonAthenaFullAccess",
  ACM: "arn:aws:iam::aws:policy/AWSCertificateManagerFullAccess",
  APIGateway: "arn:aws:iam::aws:policy/AmazonAPIGatewayAdministrator",
  ApiGateway: "arn:aws:iam::aws:policy/AmazonAPIGatewayAdministrator",
  ConfigService: "arn:aws:iam::aws:policy/AWS_ConfigRole",
  SES: "arn:aws:iam::aws:policy/AmazonSESFullAccess",
  WAFV2: "arn:aws:iam::aws:policy/AWSWAFFullAccess",
  Shield: "arn:aws:iam::aws:policy/AWSShieldDRTAccessPolicy",
  NetworkFirewall: "arn:aws:iam::aws:policy/AWSNetworkFirewallServiceRolePolicy",
  CognitoIdentityServiceProvider: "arn:aws:iam::aws:policy/AmazonCognitoPowerUser",
  Budgets: "arn:aws:iam::aws:policy/AWSBudgetsActionsWithAWSResourceControlAccess",
};

function isAccessDeniedError(e: any): boolean {
  const code = String(e?.code || e?.name || "");
  const status = e?.$metadata?.httpStatusCode || e?.statusCode || 0;
  return (
    code === "AccessDenied" ||
    code === "AccessDeniedException" ||
    code === "UnauthorizedOperation" ||
    code === "AuthorizationError" ||
    code === "UnauthorizedAccess" ||
    status === 403
  );
}

// In-memory cache so we only attach a given policy to a given principal once
// per warm container. Key = `${arn}::${policyArn}`.
const _attachedPolicyCache = new Set<string>();

function normalizeAwsConfig(service: string, config: any): any {
  const globalBillingServices = new Set(["CostExplorer", "Budgets"]);
  return {
    ...config,
    region: globalBillingServices.has(service) ? "us-east-1" : config?.region,
  };
}

/**
 * Attempts to attach the AWS-managed policy that grants permissions for the
 * given service to the calling principal (IAM user or role). Returns true if
 * an attach was performed (caller should retry the original request).
 *
 * Requires the caller's credentials to have iam:AttachUserPolicy /
 * iam:AttachRolePolicy + iam:GetUser. If those are missing, this no-ops.
 */
async function tryAutoElevate(service: string, config: any): Promise<{ attached: boolean; policyArn?: string; principal?: string; error?: string }> {
  const policyArn = SERVICE_TO_MANAGED_POLICY[service];
  if (!policyArn) return { attached: false, error: `No managed policy mapping for service ${service}` };
  const normalizedConfig = normalizeAwsConfig(service, config);

  try {
    const stsMod = await loadAwsModule("STS");
    const sts = new stsMod.STSClient(normalizedConfig);
    const id = await sts.send(new stsMod.GetCallerIdentityCommand({}));
    const callerArn: string = id.Arn || "";

    // Determine principal type + name
    // arn:aws:iam::123:user/<name>     => attach to user
    // arn:aws:iam::123:role/<name>     => attach to role
    // arn:aws:sts::123:assumed-role/<role>/<session> => attach to role <role>
    let principalType: "user" | "role" | null = null;
    let principalName = "";
    const userMatch = callerArn.match(/^arn:aws:iam::\d+:user\/(.+)$/);
    const roleMatch = callerArn.match(/^arn:aws:iam::\d+:role\/(.+)$/);
    const assumedMatch = callerArn.match(/^arn:aws:sts::\d+:assumed-role\/([^/]+)\//);
    if (userMatch) { principalType = "user"; principalName = userMatch[1]; }
    else if (roleMatch) { principalType = "role"; principalName = roleMatch[1]; }
    else if (assumedMatch) { principalType = "role"; principalName = assumedMatch[1]; }
    else return { attached: false, error: `Cannot identify principal type from ARN: ${callerArn}` };

    const cacheKey = `${callerArn}::${policyArn}`;
    if (_attachedPolicyCache.has(cacheKey)) {
      return { attached: true, policyArn, principal: callerArn };
    }

    const iamMod = await loadAwsModule("IAM");
    const iam = new iamMod.IAMClient(normalizedConfig);

    if (principalType === "user") {
      await iam.send(new iamMod.AttachUserPolicyCommand({ UserName: principalName, PolicyArn: policyArn }));
    } else {
      await iam.send(new iamMod.AttachRolePolicyCommand({ RoleName: principalName, PolicyArn: policyArn }));
    }

    _attachedPolicyCache.add(cacheKey);
    console.log(`[aws-executor] Auto-elevated ${principalType} ${principalName} with ${policyArn}`);
    // IAM policy propagation can take a few seconds; brief delay improves first-retry success.
    await new Promise((r) => setTimeout(r, 4000));
    return { attached: true, policyArn, principal: callerArn };
  } catch (elevErr: any) {
    console.warn("[aws-executor] Auto-elevation failed:", elevErr?.name, elevErr?.message);
    return { attached: false, error: `${elevErr?.name || "Error"}: ${elevErr?.message || "unknown"}` };
  }
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { service, commandName, config, params } = await req.json();

    if (!service || !commandName) {
      return new Response(JSON.stringify({ error: "service and commandName are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mod = await loadAwsModule(service);
    const normalizedConfig = normalizeAwsConfig(service, config);
    const clientName = V3_CLIENT_NAMES[service] || `${service}Client`;
    const ClientClass = mod[clientName];
    if (!ClientClass) throw new Error(`Client '${clientName}' not found for service '${service}'`);

    const CommandClass = mod[commandName];
    if (!CommandClass) throw new Error(`Command '${commandName}' not found for service '${service}'`);

    const client = new ClientClass({ ...normalizedConfig, maxAttempts: 4 });
    let elevated: { attached: boolean; policyArn?: string; principal?: string; error?: string } | null = null;
    try {
      const result = await client.send(new CommandClass(params || {}));
      const { $metadata, ...data } = result as any;
      return new Response(JSON.stringify({ result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (firstErr: any) {
      if (!isAccessDeniedError(firstErr)) throw firstErr;

      // Try to auto-elevate by attaching the managed policy for this service
      elevated = await tryAutoElevate(service, config);
      if (!elevated.attached) {
        // Couldn't elevate — surface a clear, actionable error
        const reason = elevated.error || "unknown";
        const msg = `Auto-elevation failed for ${service}. Original error: ${firstErr?.message || firstErr?.name}. Elevation attempt: ${reason}. Ensure the connected IAM principal has IAMFullAccess and SecurityAudit so CloudPilot can grant per-service permissions on demand.`;
        return new Response(JSON.stringify({
          error: msg,
          name: firstErr?.name || "AccessDenied",
          code: firstErr?.code || firstErr?.name || "AccessDenied",
          statusCode: 403,
          autoElevation: { attempted: true, attached: false, reason },
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Retry once after attaching the policy
      const retry = await client.send(new CommandClass(params || {}));
      const { $metadata: _meta, ...retryData } = retry as any;
      return new Response(JSON.stringify({
        result: retryData,
        autoElevation: { attempted: true, attached: true, policyArn: elevated.policyArn, principal: elevated.principal },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e: any) {
    console.error("[aws-executor] Error:", e.name, e.message);
    return new Response(JSON.stringify({
      error: e.message || "Execution failed",
      name: e.name || "Error",
      code: e.code || e.name || "UNKNOWN",
      statusCode: e.$metadata?.httpStatusCode || e.statusCode || 500,
    }), {
      status: 200, // Return 200 so caller can parse error details
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) {
  serve(handler);
}
