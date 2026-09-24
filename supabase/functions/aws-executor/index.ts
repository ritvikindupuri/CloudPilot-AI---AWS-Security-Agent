import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

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

  let mod: any;
  switch (service) {
    case "EC2":
      mod = await import("https://esm.sh/@aws-sdk/client-ec2@3.744.0");
      break;
    case "STS":
      mod = await import("https://esm.sh/@aws-sdk/client-sts@3.744.0");
      break;
    case "S3":
      mod = await import("https://esm.sh/@aws-sdk/client-s3@3.744.0");
      break;
    case "IAM":
      mod = await import("https://esm.sh/@aws-sdk/client-iam@3.744.0");
      break;
    case "Organizations":
      mod = await import("https://esm.sh/@aws-sdk/client-organizations@3.744.0");
      break;
    case "CloudWatch":
      mod = await import("https://esm.sh/@aws-sdk/client-cloudwatch@3.744.0");
      break;
    case "CostExplorer":
      mod = await import("https://esm.sh/@aws-sdk/client-cost-explorer@3.744.0");
      break;
    case "SNS":
      mod = await import("https://esm.sh/@aws-sdk/client-sns@3.744.0");
      break;
    case "CloudTrail":
      mod = await import("https://esm.sh/@aws-sdk/client-cloudtrail@3.744.0");
      break;
    case "CloudWatchLogs":
      mod = await import("https://esm.sh/@aws-sdk/client-cloudwatch-logs@3.744.0");
      break;
    case "Budgets":
      mod = await import("https://esm.sh/@aws-sdk/client-budgets@3.744.0");
      break;
    default:
      const pkg = _awsSvcMap[service];
      if (!pkg) throw new Error(`Unsupported AWS service: ${service}`);
      mod = await import("npm:@aws-sdk/client-" + pkg);
      break;
  }

  _awsModuleCache[service] = mod;
  return mod;
}

// ── Service-to-Policy Reference: for informational error messages only ───
// Maps AWS services to the AWS-managed policy ARNs that would grant the
// required permissions. These are used ONLY to generate helpful error messages;
// CloudPilot does not attach policies automatically.
const SERVICE_TO_MANAGED_POLICY_INFO: Record<string, string> = {
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

function normalizeAwsConfig(service: string, config: any): any {
  const globalBillingServices = new Set(["CostExplorer", "Budgets"]);
  return {
    ...config,
    region: globalBillingServices.has(service) ? "us-east-1" : config?.region,
  };
}

export const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { service, commandName, config, params } = await req.json();

    if (service === "S3" && (commandName === "PutObjectCommand" || commandName === "putObject" || commandName?.toLowerCase()?.includes("putobject")) && params && typeof params.Body === "string") {
      params.Body = new TextEncoder().encode(params.Body);
    }

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
    try {
      const result = await client.send(new CommandClass(params || {}));
      const { $metadata, ...data } = result as any;
      return new Response(JSON.stringify({ result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      if (!isAccessDeniedError(err)) throw err;

      // AccessDenied: provide clear, actionable guidance without attaching policies
      const policyArn = SERVICE_TO_MANAGED_POLICY_INFO[service];
      const msg = policyArn
        ? `Access denied for ${service}. The IAM principal lacks required permissions. To resolve, manually attach ${policyArn} or grant equivalent permissions via a custom IAM policy. Original error: ${err?.message || err?.name || "AccessDenied"}.`
        : `Access denied for ${service}. The IAM principal lacks required permissions. Review IAM policies and ensure appropriate service access is granted. Original error: ${err?.message || err?.name || "AccessDenied"}.`;

      return new Response(JSON.stringify({
        error: msg,
        name: err?.name || "AccessDenied",
        code: err?.code || err?.name || "AccessDenied",
        statusCode: 403,
        suggestedPolicy: policyArn || null,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
