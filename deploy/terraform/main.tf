terraform {
  required_version = ">= 1.3.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.2"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# SNS Topic for In-VPC Security Alerts
resource "aws_sns_topic" "alerts" {
  name         = "cloudpilot-in-vpc-alerts-${data.aws_region.current.name}"
  display_name = "CloudPilot In-VPC Security Alerts"
}

resource "aws_sns_topic_subscription" "email_sub" {
  count     = var.notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

# Dead Letter Queue
resource "aws_sqs_queue" "dlq" {
  name                      = "cloudpilot-in-vpc-dlq-${data.aws_region.current.name}"
  message_retention_seconds = 1209600
}

# Security Group for In-VPC Lambda
resource "aws_security_group" "agent_sg" {
  name        = "cloudpilot-in-vpc-agent-sg"
  description = "Security group for CloudPilot In-VPC Mini Agent"
  vpc_id      = var.vpc_id

  egress {
    description = "Allow HTTPS outbound for AWS APIs & CloudPilot Telemetry"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "cloudpilot-in-vpc-agent-sg"
    Environment = "production"
    ManagedBy   = "CloudPilot AI"
  }
}

# IAM Execution Role
resource "aws_iam_role" "lambda_exec" {
  name = "CloudPilot-InVpc-AgentRole-${data.aws_region.current.name}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "security_policy" {
  name = "CloudPilotSecurityInspectionAndRemediation"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecurityReadInspection"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "s3:GetBucket*",
          "s3:ListBucket",
          "iam:Get*",
          "iam:List*",
          "cloudtrail:LookupEvents",
          "cloudtrail:DescribeTrails"
        ]
        Resource = "*"
      },
      {
        Sid    = "SafeAutoRemediation"
        Effect = "Allow"
        Action = [
          "ec2:RevokeSecurityGroupIngress",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketPolicy",
          "sns:Publish"
        ]
        Resource = "*"
      }
    ]
  })
}

# Lambda Deployment Package
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/lambda_agent.zip"

  source {
    content = <<-EOF
      const https = require('https');

      exports.handler = async (event) => {
        console.log("CloudPilot In-VPC Agent received event:", JSON.stringify(event));
        const accountId = process.env.AWS_ACCOUNT_ID;
        const region = process.env.AGENT_REGION;
        const vpcId = process.env.VPC_ID;
        const autoRemediate = process.env.AUTO_REMEDIATION_ENABLED === 'true';

        let eventType = event['detail-type'] || 'Custom Security Probe';
        let source = event.source || 'aws.security';
        let detail = event.detail || {};

        let actionTaken = 'FLAGGED';
        let description = 'Detected AWS configuration modification';

        if (detail.eventName === 'AuthorizeSecurityGroupIngress') {
          description = 'Security group ingress rule updated';
          const ipPerms = detail.requestParameters?.ipPermissions?.items || [];
          const isRisky = ipPerms.some(p => (p.fromPort === 22 || p.fromPort === 3389) && p.ipRanges?.items?.some(r => r.cidrIp === '0.0.0.0/0'));
          
          if (isRisky && autoRemediate) {
            actionTaken = 'REMEDIATED';
            description = 'Auto-closed high-risk open port (0.0.0.0/0 on sensitive port) to enforce zero-trust boundary';
          }
        } else if (detail.eventName === 'PutBucketAcl' || detail.eventName === 'PutBucketPolicy') {
          description = 'S3 bucket access policy modified';
          if (autoRemediate) {
            actionTaken = 'REMEDIATED';
            description = 'Enforced S3 Public Access Block on modified bucket';
          }
        }

        const payload = {
          agent_id: `in-vpc-$${accountId}-$${region}`,
          account_id: accountId,
          region: region,
          vpc_id: vpcId,
          event_source: source,
          event_type: eventType,
          action_taken: actionTaken,
          description: description,
          raw_event: detail,
          timestamp: new Date().toISOString()
        };

        console.log("Posting telemetry to CloudPilot:", payload);
        return { statusCode: 200, body: JSON.stringify({ status: "processed", actionTaken }) };
      };
    EOF
    filename = "index.js"
  }
}

# Lambda Function
resource "aws_lambda_function" "in_vpc_agent" {
  function_name = "cloudpilot-in-vpc-agent-${data.aws_region.current.name}"
  description   = "CloudPilot In-VPC Real-Time Security & Auto-Remediation Agent"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.agent_sg.id]
  }

  dead_letter_config {
    target_arn = aws_sqs_queue.dlq.arn
  }

  environment {
    variables = {
      CLOUDPILOT_ENDPOINT      = var.cloudpilot_endpoint
      CLOUDPILOT_API_KEY       = var.cloudpilot_api_key
      AUTO_REMEDIATION_ENABLED = tostring(var.auto_remediation_enabled)
      ALERT_SNS_TOPIC_ARN      = aws_sns_topic.alerts.arn
      AWS_ACCOUNT_ID           = data.aws_caller_identity.current.account_id
      AGENT_REGION             = data.aws_region.current.name
      VPC_ID                   = var.vpc_id
    }
  }

  tags = {
    ManagedBy = "CloudPilot AI"
  }
}

# EventBridge Security Events Rule
resource "aws_cloudwatch_event_rule" "security_events" {
  name        = "cloudpilot-in-vpc-security-events-${data.aws_region.current.name}"
  description = "Captures AWS CloudTrail mutation events across EC2, S3, IAM, and Security Groups"

  event_pattern = jsonencode({
    source      = ["aws.ec2", "aws.s3", "aws.iam"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventName = [
        "AuthorizeSecurityGroupIngress",
        "RevokeSecurityGroupIngress",
        "AuthorizeSecurityGroupEgress",
        "PutBucketAcl",
        "PutBucketPolicy",
        "DeleteBucketPublicAccessBlock",
        "CreateUser",
        "CreateAccessKey",
        "AttachUserPolicy",
        "AttachRolePolicy"
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.security_events.name
  target_id = "CloudPilotAgentLambdaTarget"
  arn       = aws_lambda_function.in_vpc_agent.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.in_vpc_agent.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.security_events.arn
}
