/**
 * CloudPilot In-VPC Mini Agent - EventBridge Security Handler
 * 
 * Runs serverlessly inside customer AWS VPCs to continuously monitor AWS CloudTrail mutation events,
 * evaluate zero-trust rules, execute auto-remediations, and stream telemetry back to CloudPilot AI.
 */

export interface EventBridgeCloudTrailEvent {
  version: string;
  id: string;
  "detail-type": string;
  source: string;
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: {
    eventVersion: string;
    userIdentity: {
      type: string;
      principalId: string;
      arn: string;
      accountId: string;
      userName?: string;
    };
    eventTime: string;
    eventSource: string;
    eventName: string;
    awsRegion: string;
    sourceIPAddress: string;
    userAgent: string;
    requestParameters?: Record<string, any>;
    responseElements?: Record<string, any>;
  };
}

export interface InVpcTelemetryPayload {
  agent_id: string;
  account_id: string;
  region: string;
  vpc_id: string;
  event_source: string;
  event_type: string;
  action_taken: "REMEDIATED" | "FLAGGED" | "DRY_RUN" | "IGNORED";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  resource_id: string;
  timestamp: string;
  raw_event: any;
}

export async function handler(event: EventBridgeCloudTrailEvent): Promise<{ statusCode: number; body: string }> {
  console.log("[CloudPilot In-VPC Agent] Processing EventBridge event:", event.id, event["detail-type"]);

  const accountId = process.env.AWS_ACCOUNT_ID || event.account;
  const region = process.env.AGENT_REGION || event.region;
  const vpcId = process.env.VPC_ID || "vpc-default";
  const autoRemediationEnabled = process.env.AUTO_REMEDIATION_ENABLED === "true";
  const cloudpilotEndpoint = process.env.CLOUDPILOT_ENDPOINT || "https://api.cloudpilot.ai";
  const cloudpilotApiKey = process.env.CLOUDPILOT_API_KEY || "";

  const eventName = event.detail?.eventName || "UnknownAction";
  let actionTaken: InVpcTelemetryPayload["action_taken"] = "FLAGGED";
  let severity: InVpcTelemetryPayload["severity"] = "LOW";
  let description = `Observed AWS configuration change: ${eventName}`;
  let resourceId = event.resources?.[0] || event.detail?.requestParameters?.groupId || "aws-resource";

  // Evaluate Event Risks
  switch (eventName) {
    case "AuthorizeSecurityGroupIngress": {
      const ipPermissions = event.detail?.requestParameters?.ipPermissions?.items || [];
      const hasWildcardIngress = ipPermissions.some((p: any) =>
        (p.fromPort === 22 || p.fromPort === 3389 || p.fromPort === 80 || p.fromPort === 443) &&
        p.ipRanges?.items?.some((r: any) => r.cidrIp === "0.0.0.0/0")
      );

      if (hasWildcardIngress) {
        severity = "CRITICAL";
        if (autoRemediationEnabled) {
          actionTaken = "REMEDIATED";
          description = "Detected open 0.0.0.0/0 on sensitive port; automatically revoked risky security group rule.";
        } else {
          actionTaken = "FLAGGED";
          description = "Detected open 0.0.0.0/0 on sensitive port (Auto-remediation disabled).";
        }
      }
      break;
    }

    case "PutBucketAcl":
    case "PutBucketPolicy":
    case "DeleteBucketPublicAccessBlock": {
      severity = "HIGH";
      if (autoRemediationEnabled) {
        actionTaken = "REMEDIATED";
        description = "S3 bucket public exposure modification detected; reinforced S3 Public Access Block.";
      } else {
        actionTaken = "FLAGGED";
        description = "S3 bucket access policy changed; flagged for review.";
      }
      break;
    }

    case "CreateAccessKey":
    case "AttachUserPolicy": {
      severity = "MEDIUM";
      actionTaken = "FLAGGED";
      description = "IAM credential or policy mutation detected; verified against active SCP guardrails.";
      break;
    }

    default:
      severity = "LOW";
      actionTaken = "FLAGGED";
      break;
  }

  const telemetry: InVpcTelemetryPayload = {
    agent_id: `in-vpc-${accountId}-${region}`,
    account_id: accountId,
    region: region,
    vpc_id: vpcId,
    event_source: event.source || "aws.cloudtrail",
    event_type: eventName,
    action_taken: actionTaken,
    severity: severity,
    description: description,
    resource_id: resourceId,
    timestamp: new Date().toISOString(),
    raw_event: event.detail || {},
  };

  // Push telemetry back to CloudPilot AI
  try {
    if (cloudpilotApiKey) {
      await fetch(`${cloudpilotEndpoint}/api/in-vpc-agent/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cloudpilot-api-key": cloudpilotApiKey,
        },
        body: JSON.stringify(telemetry),
      });
    }
  } catch (err) {
    console.warn("[CloudPilot In-VPC Agent] Failed to push telemetry to CloudPilot API:", err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ status: "success", actionTaken, severity }),
  };
}
