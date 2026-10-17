import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { classifyAwsOperation, isPlatformAllowlisted, sanitizeAwsClientConfig, type PlatformPurpose } from "../_shared/aws-command-policy.ts";
import { GENERIC_ERRORS, logInternalError } from "../_shared/generic-error.ts";
import { consumeApprovedAction } from "../_shared/pending-aws-actions.ts";

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
    default: {
      const pkg = _awsSvcMap[service];
      if (!pkg) throw new Error(`Unsupported AWS service: ${service}`);
      mod = await import("npm:@aws-sdk/client-" + pkg);
      break;
    }
  }

  _awsModuleCache[service] = mod;
  return mod;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

export const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authError = requireServiceRole(req, serviceRoleKey, corsHeaders, "aws-executor");
  if (authError) return authError;

  try {
    const body = await req.json();
    const { service, commandName, config, params, approvalId, userId, platformPurpose } = body;

    if (!service || !commandName) {
      return json(req, { error: GENERIC_ERRORS.badRequest }, 400);
    }

    let effectiveService = service;
    let effectiveCommand = commandName;
    let effectiveParams = params;

    let decision = classifyAwsOperation(effectiveService, effectiveCommand, effectiveParams);
    if (decision.riskLevel === "BLOCKED") {
      return json(req, { error: GENERIC_ERRORS.mutationBlocked }, 403);
    }
    const purpose = platformPurpose as PlatformPurpose | undefined;
    const platformOk = isPlatformAllowlisted(purpose, effectiveService, effectiveCommand, effectiveParams);
    if (decision.requiresApproval && !platformOk) {
      if (!approvalId || !userId) {
        return json(req, { error: GENERIC_ERRORS.approvalRequired }, 403);
      }
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) return json(req, { error: GENERIC_ERRORS.misconfigured }, 500);
      const supabase = createClient(url, key);
      const approved = await consumeApprovedAction(supabase, {
        userId: String(userId),
        approvalId: String(approvalId),
        service: decision.normalizedService,
        operation: decision.normalizedOperation,
        params: effectiveParams,
      });
      if (!approved.ok) return json(req, { error: GENERIC_ERRORS.approvalInvalid }, 403);
      effectiveService = approved.record.service;
      effectiveCommand = approved.record.operation;
      effectiveParams = approved.params;
      decision = classifyAwsOperation(effectiveService, effectiveCommand, effectiveParams);
      if (decision.riskLevel === "BLOCKED") {
        return json(req, { error: GENERIC_ERRORS.mutationBlocked }, 403);
      }
    }

    const mod = await loadAwsModule(decision.normalizedService);
    const sanitized = sanitizeAwsClientConfig(config);
    const globalBillingServices = new Set(["CostExplorer", "Budgets"]);
    const normalizedConfig = {
      ...sanitized,
      region: globalBillingServices.has(decision.normalizedService) ? "us-east-1" : sanitized.region,
    };

    const clientName = V3_CLIENT_NAMES[decision.normalizedService] || `${decision.normalizedService}Client`;
    const ClientClass = mod[clientName];
    if (!ClientClass) {
      return json(req, { error: GENERIC_ERRORS.badRequest }, 400);
    }

    const CommandClass = mod[decision.normalizedCommand] || mod[effectiveCommand];
    if (!CommandClass) {
      return json(req, { error: GENERIC_ERRORS.badRequest }, 400);
    }

    if (decision.normalizedService === "S3" && /putobject/i.test(decision.normalizedOperation) && effectiveParams && typeof (effectiveParams as any).Body === "string") {
      (effectiveParams as any).Body = new TextEncoder().encode((effectiveParams as any).Body);
    }

    const client = new ClientClass({ ...normalizedConfig, maxAttempts: 4 });
    const result = await client.send(new CommandClass(effectiveParams || {}));
    const { $metadata, ...data } = result as any;
    return json(req, { result: data });
  } catch (e: any) {
    logInternalError("aws-executor", e);
    const status = e?.$metadata?.httpStatusCode || e?.statusCode;
    if (status === 403) {
      return json(req, { error: GENERIC_ERRORS.accessDenied }, 403);
    }
    return json(req, { error: GENERIC_ERRORS.awsFailed }, 502);
  }
};

if (import.meta.main) {
  serve(handler);
}
