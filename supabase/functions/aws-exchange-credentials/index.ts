import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from "https://esm.sh/@aws-sdk/client-sts@3.744.0";
import { IAMClient, SimulatePrincipalPolicyCommand } from "https://esm.sh/@aws-sdk/client-iam@3.744.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AWS_REGION_REGEX = /^[a-z]{2}(-[a-z]+-\d+)?$/;
const ACCESS_KEY_REGEX = /^[A-Z0-9]{16,128}$/;
const ROLE_ARN_REGEX = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

function sanitizeString(val: unknown, maxLen: number): string {
  if (typeof val !== "string") return "";
  return val
    .slice(0, maxLen)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

function sanitizeCredentialValue(val: unknown, maxLen: number): string {
  return sanitizeString(val, maxLen).replace(/\s+/g, "");
}

function toPolicySourceArn(identityArn: string): string {
  const assumedRoleMatch = identityArn.match(/^arn:aws:sts::(\d{12}):assumed-role\/([^/]+)\//);
  if (assumedRoleMatch) {
    return `arn:aws:iam::${assumedRoleMatch[1]}:role/${assumedRoleMatch[2]}`;
  }
  return identityArn;
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { credentials } = await req.json();

    if (!credentials || typeof credentials !== "object") {
      return new Response(
        JSON.stringify({ error: "AWS credentials are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const region = sanitizeString(credentials.region, 30);
    if (!AWS_REGION_REGEX.test(region)) {
      return new Response(
        JSON.stringify({ error: "Invalid AWS region format." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let tempCredentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiration: string;
    };
    let identity: { account: string; arn: string; userId: string };
    let policySourceArn = "";

    if (credentials.method === "access_key") {
      const accessKeyId = sanitizeCredentialValue(credentials.accessKeyId, 128);
      const secretAccessKey = sanitizeCredentialValue(credentials.secretAccessKey, 256);
      const providedSessionToken = credentials.sessionToken
        ? sanitizeCredentialValue(credentials.sessionToken, 4096)
        : "";

      if (!accessKeyId || !secretAccessKey) {
        return new Response(
          JSON.stringify({ error: "Access Key ID and Secret Access Key are required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!ACCESS_KEY_REGEX.test(accessKeyId)) {
        return new Response(
          JSON.stringify({ error: "Invalid Access Key ID format." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (accessKeyId.startsWith("ASIA") && !providedSessionToken) {
        return new Response(
          JSON.stringify({
            error: "Temporary AWS credentials require a session token. Paste the Session Token together with the access key and secret.",
            code: "MissingSessionToken",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sts = new STSClient({
        credentials: {
          accessKeyId,
          secretAccessKey,
          sessionToken: providedSessionToken || undefined,
        },
        region,
      });

      const callerIdentity = await sts.send(new GetCallerIdentityCommand({}));
      identity = {
        account: callerIdentity.Account || "",
        arn: callerIdentity.Arn || "",
        userId: callerIdentity.UserId || "",
      };
      policySourceArn = toPolicySourceArn(identity.arn);

      if (providedSessionToken) {
        console.log("[aws-exchange-credentials] Temporary credentials provided, skipping GetSessionToken");
        tempCredentials = {
          accessKeyId,
          secretAccessKey,
          sessionToken: providedSessionToken,
          expiration: new Date(Date.now() + 3600 * 1000).toISOString(),
        };
      } else {
        // Do not call STS:GetSessionToken for long-term IAM user keys.
        // AWS blocks IAM API operations from GetSessionToken credentials unless MFA
        // auth is included, which prevents CloudPilot's IAMFullAccess-based
        // auto-elevation from attaching per-service policies on demand.
        tempCredentials = {
          accessKeyId,
          secretAccessKey,
          sessionToken: "",
          expiration: new Date(Date.now() + 3600 * 1000).toISOString(),
        };
      }
    } else if (credentials.method === "assume_role") {
      const roleArn = sanitizeString(credentials.roleArn, 256);
      if (!roleArn || !ROLE_ARN_REGEX.test(roleArn)) {
        return new Response(
          JSON.stringify({
            error:
              "Invalid Role ARN format. Expected: arn:aws:iam::<account-id>:role/<role-name>",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const stsConfig: Record<string, unknown> = { region };
      if (credentials.accessKeyId && credentials.secretAccessKey) {
        stsConfig.credentials = {
          accessKeyId: sanitizeCredentialValue(credentials.accessKeyId, 128),
          secretAccessKey: sanitizeCredentialValue(credentials.secretAccessKey, 256),
          sessionToken: credentials.sessionToken
            ? sanitizeCredentialValue(credentials.sessionToken, 4096)
            : undefined,
        };
      }

      const sts = new STSClient(stsConfig);
      const assumedRole = await sts.send(new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `CloudPilot-${Date.now()}`,
        DurationSeconds: 3600,
      }));

      if (!assumedRole.Credentials?.AccessKeyId || !assumedRole.Credentials?.SecretAccessKey || !assumedRole.Credentials?.SessionToken || !assumedRole.Credentials?.Expiration) {
        throw new Error("Failed to assume role.");
      }

      const assumedSts = new STSClient({
        credentials: {
          accessKeyId: assumedRole.Credentials.AccessKeyId,
          secretAccessKey: assumedRole.Credentials.SecretAccessKey,
          sessionToken: assumedRole.Credentials.SessionToken,
        },
        region,
      });
      const callerIdentity = await assumedSts.send(new GetCallerIdentityCommand({}));
      identity = {
        account: callerIdentity.Account || "",
        arn: callerIdentity.Arn || "",
        userId: callerIdentity.UserId || "",
      };
      policySourceArn = roleArn;

      tempCredentials = {
        accessKeyId: assumedRole.Credentials.AccessKeyId,
        secretAccessKey: assumedRole.Credentials.SecretAccessKey,
        sessionToken: assumedRole.Credentials.SessionToken,
        expiration: assumedRole.Credentials.Expiration.toISOString(),
      };
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported credentials method: ${credentials.method}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const iam = new IAMClient({
      credentials: {
        accessKeyId: tempCredentials.accessKeyId,
        secretAccessKey: tempCredentials.secretAccessKey,
        sessionToken: tempCredentials.sessionToken || undefined,
      },
      region,
    });

    const actionsToTest = [
      "apigateway:GET",
      "budgets:ModifyBudget",
      "budgets:ViewBudget",
      "ce:GetCostAndUsage",
      "cloudtrail:DescribeTrails",
      "cloudtrail:GetEventSelectors",
      "cloudtrail:GetTrailStatus",
      "cloudtrail:LookupEvents",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:PutAnomalyDetector",
      "cloudwatch:PutDashboard",
      "cloudwatch:PutMetricAlarm",
      "config:DescribeConfigurationRecorders",
      "config:DescribeConfigurationRecorderStatus",
      "dynamodb:ListTables",
      "ec2:AllocateAddress",
      "ec2:AssociateRouteTable",
      "ec2:AttachInternetGateway",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateInternetGateway",
      "ec2:CreateNatGateway",
      "ec2:CreateRoute",
      "ec2:CreateRouteTable",
      "ec2:CreateSecurityGroup",
      "ec2:CreateSnapshot",
      "ec2:CreateSubnet",
      "ec2:CreateTags",
      "ec2:CreateVpc",
      "ec2:DeleteInternetGateway",
      "ec2:DeleteNatGateway",
      "ec2:DeleteRoute",
      "ec2:DeleteRouteTable",
      "ec2:DeleteSecurityGroup",
      "ec2:DeleteSubnet",
      "ec2:DeleteTags",
      "ec2:DeleteVpc",
      "ec2:DescribeAddresses",
      "ec2:DescribeInstances",
      "ec2:DescribeInternetGateways",
      "ec2:DescribeLaunchTemplates",
      "ec2:DescribeNatGateways",
      "ec2:DescribeNetworkAcls",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVolumes",
      "ec2:DescribeVpcEndpoints",
      "ec2:DescribeVpcPeeringConnections",
      "ec2:DescribeVpcs",
      "ec2:DetachInternetGateway",
      "ec2:DisassociateRouteTable",
      "ec2:ModifyInstanceAttribute",
      "ec2:ModifyInstanceMetadataOptions",
      "ec2:ReleaseAddress",
      "ec2:ReplaceNetworkAclEntry",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:RunInstances",
      "ec2:StopInstances",
      "ec2:TerminateInstances",
      "ecs:DescribeTaskDefinition",
      "ecs:ListTaskDefinitions",
      "elasticloadbalancing:DescribeLoadBalancers",
      "guardduty:CreateDetector",
      "guardduty:GetDetector",
      "guardduty:GetFindings",
      "guardduty:GetMalwareScanSettings",
      "guardduty:ListDetectors",
      "guardduty:ListFindings",
      "guardduty:UpdateDetector",
      "iam:AttachRolePolicy",
      "iam:AttachUserPolicy",
      "iam:CreatePolicy",
      "iam:DetachUserPolicy",
      "iam:GenerateCredentialReport",
      "iam:GetAccountAuthorizationDetails",
      "iam:GetAccountPasswordPolicy",
      "iam:GetCredentialReport",
      "iam:GetGroup",
      "iam:ListAccessKeys",
      "iam:ListAttachedUserPolicies",
      "iam:ListMFADevices",
      "iam:ListRoles",
      "iam:ListUsers",
      "iam:SimulatePrincipalPolicy",
      "iam:UpdateAccessKey",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:GetPolicy",
      "lambda:ListFunctions",
      "logs:DescribeMetricFilters",
      "logs:FilterLogEvents",
      "logs:GetQueryResults",
      "logs:PutMetricFilter",
      "logs:StartQuery",
      "organizations:ListAccounts",
      "organizations:ListPolicies",
      "organizations:ListTargetsForPolicy",
      "rds:DescribeDBClusters",
      "rds:DescribeDBInstances",
      "s3:GetAccountPublicAccessBlock",
      "s3:GetBucketAcl",
      "s3:GetBucketLogging",
      "s3:GetBucketObjectLockConfiguration",
      "s3:GetBucketPolicy",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListAllMyBuckets",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecrets",
      "securityhub:DescribeHub",
      "securityhub:GetEnabledStandards",
      "securityhub:GetFindings",
      "ses:GetIdentityVerificationAttributes",
      "ses:ListIdentities",
      "sns:ListSubscriptions",
      "sns:ListSubscriptionsByTopic",
      "sns:ListTopics",
      "ssm:DescribeParameters",
      "ssm:GetParameters",
      "sts:AssumeRole",
      "sts:GetCallerIdentity",
      "sts:GetSessionToken",
      "wafv2:GetIPSet",
      "wafv2:GetSampledRequests",
      "wafv2:ListIPSets",
      "wafv2:UpdateIPSet",
    ];

    const permissions: Record<string, boolean> = {};

    try {
      const chunks = Array.from({ length: Math.ceil(actionsToTest.length / 100) }, (_, index) =>
        actionsToTest.slice(index * 100, (index + 1) * 100)
      );

      for (const actionBatch of chunks) {
        const simResult = await iam.send(new SimulatePrincipalPolicyCommand({
          PolicySourceArn: policySourceArn,
          ActionNames: actionBatch,
        }));

        if (simResult.EvaluationResults) {
          simResult.EvaluationResults.forEach((result) => {
            if (result.EvalActionName) {
              permissions[result.EvalActionName] = result.EvalDecision === "allowed";
            }
          });
        }
      }
    } catch (e) {
      console.warn("SimulatePrincipalPolicy failed", e);
    }

    return new Response(
      JSON.stringify({
        sessionCredentials: {
          accessKeyId: tempCredentials.accessKeyId,
          secretAccessKey: tempCredentials.secretAccessKey,
          sessionToken: tempCredentials.sessionToken,
          expiration: tempCredentials.expiration,
          region,
        },
        identity,
        permissions,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const errorCode = err?.Code || err?.code || err?.name || "CredentialValidationFailed";
    const message = err?.message || "Credential validation failed.";
    const statusCode = err?.$metadata?.httpStatusCode || err?.statusCode || 400;
    const isAccessDenied =
      errorCode === "AccessDeniedException" ||
      errorCode === "AccessDenied" ||
      statusCode === 403;
    const isInvalidToken = errorCode === "InvalidClientTokenId";
    const isSignatureMismatch =
      errorCode === "SignatureDoesNotMatch" || errorCode === "IncompleteSignature";
    const isHandledCredentialError =
      isInvalidToken ||
      isSignatureMismatch ||
      isAccessDenied ||
      errorCode === "ExpiredToken" ||
      errorCode === "InvalidAccessKeyId" ||
      errorCode === "AuthFailure";

    console.error("[aws-exchange-credentials] Validation failed", {
      errorCode,
      message,
      statusCode,
    });

    let friendlyMessage = message;
    if (isInvalidToken) {
      friendlyMessage = "AWS rejected the submitted credentials. This usually means the Access Key ID is inactive or deleted, the Secret Access Key does not match, or temporary credentials were pasted without the Session Token.";
    } else if (isSignatureMismatch) {
      friendlyMessage = "AWS could not verify the Secret Access Key. Double-check the secret and remove any extra spaces or line breaks before retrying.";
    } else if (isAccessDenied) {
      friendlyMessage = `Access Denied: ${message}. Ensure your IAM user or role has sts:GetCallerIdentity and sts:GetSessionToken permissions.`;
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: friendlyMessage,
        code: errorCode,
        details: message,
      }),
      {
        status: isHandledCredentialError ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

if (import.meta.main) {
  serve(handler);
}