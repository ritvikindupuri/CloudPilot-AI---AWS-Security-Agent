import {
  Shield, Search, AlertTriangle, Lock, Server,
  Database, Globe, Users, FileSearch, Zap,
  Eye, Activity, Network, HardDrive, Swords,
  Key, Radio, GitBranch, Cpu, Fingerprint, Target,
  FileText, Radar, Bot, ClipboardList, Ban,
  UserX, BellRing, Archive, Mail, ShieldCheck,
  BarChart3, Bell, Gauge, ScrollText, LayoutDashboard,
  Siren, Bug, ShieldAlert, KeyRound, Map,
  Ghost, Skull, Wand2, ChevronDown, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FastScanIcon, DeepAuditIcon } from "./ScanModeIcons";
import { AwsCredentials } from "./AwsCredentialsPanel";
import { QuickActionPermissionsDialog } from "./QuickActionPermissionsDialog";
import { useState } from "react";

interface QuickActionItem {
  icon: any;
  label: string;
  prompt: string;
  requiredPermissions: string[];
  recommendedMode?: "fast" | "deep";
  recommendationReason?: string;
}

interface QuickActionsProps {
  onAction: (prompt: string) => void;
  disabled?: boolean;
  credentials?: AwsCredentials | null;
}

const categories = [
  {
    label: "AUDIT",
    color: "text-blue-400",
    actions: [
      {
        icon: Search,
        label: "S3 Buckets",
        prompt: "Query all S3 buckets in the account using real AWS API calls. For each bucket check: public access block settings, bucket ACL, bucket policy (identify external principals), default encryption, versioning status, access logging, and replication. Present real findings in a severity-ranked table with the actual bucket names and configurations you retrieved.",
        requiredPermissions: ["s3:ListAllMyBuckets","s3:GetBucketPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetReplicationConfiguration"],
        recommendedMode: "fast",
        recommendationReason: "Single-pass bucket configuration listing handles this query fast (~2–5s).",
      },
      {
        icon: LayoutDashboard,
        label: "Unified Audit",
        prompt: "Show me everything wrong with my AWS account. Run a formal unified audit across IAM, S3, security groups, EC2, and cost exposure. Return a neatly formatted report with an executive summary, top three issues, recommended fix order, and notable patterns.",
        requiredPermissions: ["iam:GetAccountAuthorizationDetails","s3:ListAllMyBuckets","ec2:DescribeSecurityGroups","ec2:DescribeInstances","ce:GetCostAndUsage"],
        recommendedMode: "deep",
        recommendationReason: "Multi-pass analysis across IAM, S3, EC2, VPC & Cost Explorer required for full account synthesis.",
      },
      {
        icon: Gauge,
        label: "Cost Anomalies",
        prompt: "Find cost anomalies in my AWS account. Pull the recent cost breakdown, identify spikes or accelerating trends, check for idle EC2 instances, and return a formal summary with recommended actions.",
        requiredPermissions: ["ce:GetCostAndUsage","ec2:DescribeInstances"],
        recommendedMode: "fast",
        recommendationReason: "Fast single-pass Cost Explorer query returns spend metrics quickly (~2–5s).",
      },
      {
        icon: ClipboardList,
        label: "Drift Digest",
        prompt: "Run a formal overnight drift detection report for my AWS account. Compare the current live state against the stored baseline for security groups, IAM users, and S3 buckets, then return a neatly formatted drift digest with severity-ranked changes, explanations, and fix prompts. Do not use emojis.",
        requiredPermissions: ["ec2:DescribeSecurityGroups","iam:GetAccountAuthorizationDetails","s3:ListAllMyBuckets"],
        recommendedMode: "deep",
        recommendationReason: "Multi-pass diff required to compare live state against security baselines.",
      },
      {
        icon: Users,
        label: "Org MFA Gaps",
        prompt: "Which accounts have no MFA enforced? Run a formal organization-wide query and identify accounts where IAM users do not have MFA devices enabled.",
        requiredPermissions: ["organizations:ListAccounts","iam:ListUsers","iam:ListMFADevices"],
        recommendedMode: "fast",
        recommendationReason: "Fast single-pass listing of Organization accounts and MFA devices (~2–5s).",
      },
      {
        icon: Archive,
        label: "Org SCP Inventory",
        prompt: "What SCPs are applied to the organization? Run a formal organization-wide query and show every service control policy with its current attachments.",
        requiredPermissions: ["organizations:ListPolicies","organizations:ListTargetsForPolicy"],
        recommendedMode: "fast",
        recommendationReason: "Fast Organization policy listing query (~2–5s).",
      },
      {
        icon: FileText,
        label: "Runbook Dry Run",
        prompt: "Run the cost spike remediation playbook in dry-run mode. Show the full formal step plan, identify which steps are automatic, which require confirmation, and stop before any AWS action step.",
        requiredPermissions: ["ce:GetCostAndUsage","ec2:DescribeInstances"],
        recommendedMode: "fast",
        recommendationReason: "Fast single-pass step plan generation (~2–5s).",
      },
      {
        icon: Lock,
        label: "IAM Posture",
        prompt: "Perform a full IAM audit using real AWS API calls. Query: all IAM users and their MFA status, all access keys and last used dates, users/roles with AdministratorAccess or wildcard policies, password policy settings, users with console access but no MFA, unused credentials older than 90 days. Use getAccountAuthorizationDetails for a comprehensive policy dump. Show real account data only.",
        requiredPermissions: ["iam:GetAccountAuthorizationDetails","iam:ListUsers","iam:ListAccessKeys","iam:GetAccountPasswordPolicy","iam:ListMFADevices","iam:GetCredentialReport"],
        recommendedMode: "deep",
        recommendationReason: "Recursive IAM policy dump & privilege escalation path discovery required.",
      },
      {
        icon: AlertTriangle,
        label: "Security Groups",
        prompt: "Audit all EC2 security groups using real AWS API calls. Find every group with inbound rules allowing 0.0.0.0/0 or ::/0, especially on ports: 22 (SSH), 3389 (RDP), 3306 (MySQL), 5432 (Postgres), 1433 (MSSQL), 27017 (MongoDB), 6379 (Redis), 9200 (Elasticsearch), 8080/8443 (alt HTTP). List real group IDs, VPCs, and attached resources.",
        requiredPermissions: ["ec2:DescribeSecurityGroups","ec2:DescribeNetworkInterfaces"],
        recommendedMode: "fast",
        recommendationReason: "Fast single-pass security group ingress rule inspection (~2–5s).",
      },
      {
        icon: Server,
        label: "EC2 Instances",
        prompt: "Audit all EC2 instances with real API calls. Check each instance for: public IP assignment, IMDSv2 enforcement (HttpTokens=required), unencrypted EBS volumes, IAM instance profile presence, running as root (check user data), stopped instances still accruing cost. Also check launch templates for IMDSv1 defaults. Return real instance IDs and states.",
        requiredPermissions: ["ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeLaunchTemplates"],
        recommendedMode: "fast",
        recommendationReason: "Fast instance metadata & IMDSv2 configuration check (~2–5s).",
      },
      {
        icon: Database,
        label: "RDS / Aurora",
        prompt: "Audit all RDS and Aurora instances using real AWS APIs. Check: publicly accessible flag, storage encryption status, automated backup retention period, deletion protection, IAM database authentication, SSL/TLS enforcement via parameter groups, multi-AZ configuration, and Enhanced Monitoring. List real DB instance identifiers and their configurations.",
        requiredPermissions: ["rds:DescribeDBInstances","rds:DescribeDBClusters"],
        recommendedMode: "fast",
        recommendationReason: "Fast database cluster configuration check (~2–5s).",
      },
      {
        icon: Cpu,
        label: "Lambda Security",
        prompt: "Audit all Lambda functions using real AWS API calls. For each function check: execution role permissions (are they overly broad?), environment variables for hardcoded secrets or API keys, function policy for public or cross-account access, VPC configuration (functions that should be VPC-isolated), runtime versions for EOL runtimes, and reserved concurrency. Show real function names and findings.",
        requiredPermissions: ["lambda:ListFunctions","lambda:GetFunction","lambda:GetPolicy"],
        recommendedMode: "deep",
        recommendationReason: "Recursive execution role policy & environment variable analysis required.",
      },
      {
        icon: ShieldCheck,
        label: "IP Safety Check",
        prompt: "Check if the current IP or specific IP ranges are acceptable and safe from cyberattacks for EC2 instances and in general using real AWS APIs. Review security group ingress rules, NACLs, and WAF IP sets. Identify exposing rules allowing dangerous traffic from untrusted IPs.",
        requiredPermissions: ["ec2:DescribeSecurityGroups","ec2:DescribeNetworkAcls","wafv2:ListIPSets","wafv2:GetIPSet"],
        recommendedMode: "fast",
        recommendationReason: "Fast single-pass IP set & NACL ingress rule lookup (~2–5s).",
      },
      {
        icon: FileText,
        label: "Log Analyst",
        prompt: "Parse and summarize CloudTrail and CloudWatch logs. Query recent events related to unauthorized API calls, console logins without MFA, or sensitive resource deletions. Present findings in a structured summary table.",
        requiredPermissions: ["cloudtrail:LookupEvents","logs:FilterLogEvents"],
        recommendedMode: "fast",
        recommendationReason: "Fast log event filtering & summary table output (~2–5s).",
      },
    ],
  },
  {
    label: "COMPLIANCE",
    color: "text-green-400",
    actions: [
      {
        icon: Shield,
        label: "CIS Benchmark",
        prompt: "Run a real CIS AWS Foundations Benchmark v3.0 assessment. Query the actual account configuration for each control: IAM password policy, root account MFA and access keys, CloudTrail multi-region status, Config recorder, VPC default security group rules, S3 Block Public Access at account level, GuardDuty enablement, Security Hub enablement. Report real pass/fail for each control with evidence.",
        requiredPermissions: ["iam:GetAccountPasswordPolicy","iam:GetCredentialReport","cloudtrail:DescribeTrails","config:DescribeConfigurationRecorders","s3:GetAccountPublicAccessBlock","guardduty:ListDetectors","securityhub:DescribeHub"],
        recommendedMode: "deep",
        recommendationReason: "Multi-pass CIS AWS Foundations Benchmark evaluation across multiple control areas.",
      },
      {
        icon: Eye,
        label: "CloudTrail",
        prompt: "Verify CloudTrail configuration using real API calls. Check: multi-region trail enabled, log file validation enabled, S3 bucket logging, KMS encryption of logs, CloudWatch Logs integration, event selectors (management events, data events for S3/Lambda), trail status (is logging active?), and S3 bucket policy on the logging bucket. Show the real trail ARNs and their configuration.",
        requiredPermissions: ["cloudtrail:DescribeTrails","cloudtrail:GetTrailStatus","cloudtrail:GetEventSelectors"],
        recommendedMode: "fast",
        recommendationReason: "Fast trail configuration & logging status verification (~2–5s).",
      },
      {
        icon: Activity,
        label: "GuardDuty",
        prompt: "Check GuardDuty status and findings using real AWS API calls. Query: detector status in the current region, all active findings sorted by severity (CRITICAL/HIGH first), S3 protection status, EKS audit log protection, Lambda protection, RDS login protection, and malware scan settings. List real finding IDs, types, and affected resources.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:ListFindings","guardduty:GetFindings"],
        recommendedMode: "fast",
        recommendationReason: "Fast detector & finding list lookup (~2–5s).",
      },
      {
        icon: Radio,
        label: "Security Hub",
        prompt: "Query AWS Security Hub using real API calls. Get: enabled security standards (CIS, PCI-DSS, NIST, AWS Foundational), failed controls sorted by severity, critical and high findings, suppressed vs active findings breakdown, and cross-region aggregation status. Show real finding counts and the top 10 most critical controls failing in the account.",
        requiredPermissions: ["securityhub:GetEnabledStandards","securityhub:GetFindings"],
        recommendedMode: "fast",
        recommendationReason: "Fast Security Hub finding summary lookup (~2–5s).",
      },
    ],
  },
  {
    label: "ATTACK SIMULATION",
    color: "text-red-400",
    actions: [
      {
        icon: Swords,
        label: "Privilege Escalation",
        prompt: "Perform a real IAM privilege escalation assessment. Use AWS API calls to: enumerate all IAM users, roles, and their attached/inline policies, then identify every escalation path — CreatePolicyVersion, SetDefaultPolicyVersion, AttachUserPolicy, AttachRolePolicy, PutUserPolicy, PutRolePolicy, CreateAccessKey on other users, UpdateAssumeRolePolicy, AddUserToGroup, PassRole to Lambda/EC2/CloudFormation, iam:CreateLoginProfile. For each path found, show the exact policy that enables it and the real principal that has the permission.",
        requiredPermissions: ["iam:GetAccountAuthorizationDetails","iam:ListUsers","iam:ListRoles"],
        recommendedMode: "deep",
        recommendationReason: "Multi-pass IAM policy analysis required to discover complex privilege escalation vectors.",
      },
      {
        icon: Key,
        label: "Secrets Exposure",
        prompt: "Run a real secrets exposure scan. Use AWS API calls to: check all Lambda function environment variables for credentials patterns, query EC2 instance user data for secrets (describe instances), list all SSM Parameter Store parameters and identify plaintext vs SecureString, check Secrets Manager for resource policies allowing broad access, check EC2 metadata service enforcement (IMDSv2) to assess SSRF-to-credential-theft risk. Report real findings from actual API responses.",
        requiredPermissions: ["lambda:ListFunctions","lambda:GetFunctionConfiguration","ec2:DescribeInstances","ssm:DescribeParameters","ssm:GetParameters","secretsmanager:ListSecrets","secretsmanager:GetResourcePolicy"],
        recommendedMode: "deep",
        recommendationReason: "Multi-service scan across Lambda, EC2, SSM Parameter Store & Secrets Manager.",
      },
      {
        icon: Target,
        label: "S3 Exfil Paths",
        prompt: "Map real S3 data exfiltration paths. Use AWS API calls to: list all buckets and test their GetBucketAcl and GetBucketPolicy, identify buckets with public read/write/list access, find buckets with cross-account policies (external AWS account principals), check for S3 replication rules sending data to external buckets, identify overly permissive bucket policies granting s3:GetObject or s3:* to '*'. Report real bucket names and the actual policy statements that enable exfiltration.",
        requiredPermissions: ["s3:ListAllMyBuckets","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetReplicationConfiguration"],
        recommendedMode: "deep",
        recommendationReason: "Multi-pass ACL & bucket policy evaluation for cross-account exfiltration paths.",
      },
      {
        icon: GitBranch,
        label: "Lateral Movement",
        prompt: "Map real lateral movement paths in the account. Use AWS API calls to: enumerate VPC peering connections and route tables, list EC2 instances with IAM roles that have cross-service permissions (e.g., ec2 instance with s3:* or iam:PassRole), enumerate ECS task definitions with privileged containers or host networking, map Lambda execution roles with permissions to assume other roles, identify trust relationships in IAM roles enabling cross-service pivoting. Show real resource IDs and the exact permissions enabling each movement path.",
        requiredPermissions: ["ec2:DescribeVpcPeeringConnections","ec2:DescribeRouteTables","ec2:DescribeInstances","ecs:ListTaskDefinitions","ecs:DescribeTaskDefinition","lambda:ListFunctions"],
        recommendedMode: "deep",
        recommendationReason: "Multi-pass topology traversal across VPC Peering, ECS, Lambda & cross-service IAM roles.",
      },
      {
        icon: Fingerprint,
        label: "Detection Gaps",
        prompt: "Assess real detection and monitoring gaps. Use AWS API calls to: check GuardDuty detector status in ALL regions (list regions, check each), verify CloudTrail is logging in all regions (not just the primary), identify AWS services with no CloudWatch alarms on critical API calls (DeleteTrail, PutBucketPolicy, CreateUser, AttachUserPolicy), check if CloudTrail S3 data events are enabled, verify Config recorder is active, check if root account activity generates alerts. Show the real gaps found.",
        requiredPermissions: ["guardduty:ListDetectors","cloudtrail:DescribeTrails","cloudwatch:DescribeAlarms","config:DescribeConfigurationRecorders"],
        recommendedMode: "deep",
        recommendationReason: "Multi-region detector & CloudTrail multi-region monitoring gap analysis.",
      },
      {
        icon: Network,
        label: "Network Exposure",
        prompt: "Map the real external network attack surface. Use AWS API calls to: enumerate all security groups with 0.0.0.0/0 inbound rules across all VPCs, find EC2 instances with public IPs AND sensitive IAM roles (SSRF-to-privilege-escalation), check for publicly accessible RDS instances, find load balancers with HTTP (non-HTTPS) listeners, enumerate API Gateways without WAF or without authentication, check for VPC endpoints missing policies. Show real resource identifiers and the exact exposure.",
        requiredPermissions: ["ec2:DescribeSecurityGroups","ec2:DescribeInstances","rds:DescribeDBInstances","elasticloadbalancing:DescribeLoadBalancers","apigateway:GET","ec2:DescribeVpcEndpoints"],
        recommendedMode: "deep",
        recommendationReason: "Multi-service attack surface analysis across Security Groups, ELB, API Gateway & VPC Endpoints.",
      },
      {
        icon: Radar,
        label: "Threat Detector",
        prompt: "Perform anomaly and IOC pattern matching using real AWS API calls. Query GuardDuty findings, WAF sampled requests, and CloudTrail for known indicators of compromise (IOCs) such as anomalous geolocation logins, Tor exit node activity, or cryptocurrency mining patterns.",
        requiredPermissions: ["guardduty:ListFindings","wafv2:GetSampledRequests","cloudtrail:LookupEvents"],
        recommendedMode: "fast",
        recommendationReason: "Fast IOC pattern lookup across GuardDuty & WAF logs (~2–5s).",
      },
      {
        icon: Target,
        label: "Auto Pen Test",
        prompt: "Spin up an attack simulation environment: 1) Create a new VPC, Subnet, and Security Group (allow SSH/HTTP from 0.0.0.0/0), 2) Launch an EC2 instance with a vulnerable configuration (e.g., exposing critical infrastructure metadata or overly permissive IAM role), 3) Run an automated penetration test (simulate an attacker exploiting the public exposure or SSRF to grab credentials), 4) Report the findings and attack path in detail. Finally, you must ask me to confirm the deletion of all services created for this simulation to clean up.",
        requiredPermissions: ["ec2:CreateVpc","ec2:CreateSubnet","ec2:CreateSecurityGroup","ec2:RunInstances","ec2:TerminateInstances"],
        recommendedMode: "deep",
        recommendationReason: "Multi-step automated penetration testing & sandbox environment lifecycle management.",
      },
      {
        icon: Skull,
        label: "AI vs AI Sim",
        prompt: "Run an AI-vs-AI attack simulation engine. Simulate a controlled attacker agent attempting privilege escalation on the current account. Act as the main agent to detect, explain, and respond to those actions in real time. Include dynamic attack path mapping and unified risk scoring in your report.",
        requiredPermissions: ["cloudtrail:LookupEvents","guardduty:ListFindings"],
      },
      {
        icon: Wand2,
        label: "Auto Defense",
        prompt: "Operate as an autonomous defense system. Run a dynamic attack path mapping of the current IAM structure to find multi-step paths an attacker could take. If you find a severe path, propose an autonomous incident response runbook to quarantine the risk.",
        requiredPermissions: ["iam:GetAccountAuthorizationDetails"],
      },
    ],
  },
  {
    label: "INCIDENT RESPONSE",
    color: "text-orange-400",
    actions: [
      {
        icon: Zap,
        label: "Isolate Instance",
        prompt: "Guide me through isolating a potentially compromised EC2 instance using real AWS API calls. Steps: (1) Query running instances to identify the target, (2) Create a quarantine security group with no inbound/outbound rules, (3) Remove existing security groups and apply quarantine group, (4) Create EBS snapshots for forensic preservation, (5) Disable IMDS on the instance, (6) Tag the instance as quarantined with timestamp. Execute each step with real API calls and show the results.",
        requiredPermissions: ["ec2:DescribeInstances","ec2:CreateSecurityGroup","ec2:ModifyInstanceAttribute","ec2:CreateSnapshot"],
      },
      {
        icon: FileSearch,
        label: "Credential Audit",
        prompt: "Perform an emergency credential audit using real AWS API calls. Query: all IAM users and their access key status and last-used dates, all active console sessions via IAM, CloudTrail events in the last 24 hours for credential-related API calls (CreateAccessKey, GetSecretAccessKey), any new IAM users or roles created recently, access keys that have never been used or haven't been used in 90+ days. Return real user names, key IDs, and timestamps.",
        requiredPermissions: ["iam:ListUsers","iam:ListAccessKeys","cloudtrail:LookupEvents"],
      },
      {
        icon: HardDrive,
        label: "Forensic Snapshot",
        prompt: "Create forensic snapshots using real AWS API calls. Query all EC2 instances to identify target instances, then for each compromised instance: create EBS snapshots of all attached volumes with forensic tags (Reason, Timestamp, IncidentID), capture instance metadata (instance type, AMI, network config, IAM role), check if CloudTrail logs are being delivered to S3. Show real snapshot IDs and preservation commands.",
        requiredPermissions: ["ec2:DescribeInstances","ec2:CreateSnapshot","cloudtrail:DescribeTrails"],
      },
      {
        icon: Users,
        label: "Blast Radius",
        prompt: "Assess the blast radius of a potential compromise using real AWS API calls. Query: all IAM roles with trust policies allowing ec2.amazonaws.com or lambda.amazonaws.com (potential pivot targets), all cross-account role assumptions in CloudTrail last 7 days, all S3 buckets accessible by the potentially compromised identity, RDS instances accessible from the VPC, secrets accessible via the identity's permissions. Show real resources at risk.",
        requiredPermissions: ["iam:ListRoles","cloudtrail:LookupEvents","s3:ListAllMyBuckets","rds:DescribeDBInstances"],
      },
      {
        icon: Ban,
        label: "Block IPs",
        prompt: "Automate IP blocking using real AWS API calls. Query WAF IP sets and EC2 Network ACLs to identify existing block rules. Generate the exact AWS CLI commands to append newly identified malicious IPs to WAF IP sets or NACL deny rules.",
        requiredPermissions: ["wafv2:ListIPSets","wafv2:UpdateIPSet","ec2:DescribeNetworkAcls","ec2:ReplaceNetworkAclEntry"],
      },
      {
        icon: UserX,
        label: "Revoke IAM",
        prompt: "Automate IAM revocation using real AWS API calls. Query active access keys and attached policies for a specified user or role. Generate the exact AWS CLI commands to deactivate their access keys and detach all associated permissions policies immediately.",
        requiredPermissions: ["iam:ListAccessKeys","iam:UpdateAccessKey","iam:ListAttachedUserPolicies","iam:DetachUserPolicy"],
      },
    ],
  },
  {
    label: "GUARDDUTY",
    color: "text-pink-400",
    actions: [
      {
        icon: Target,
        label: "Threat Hunting",
        prompt: "Perform advanced threat hunting using GuardDuty findings via real AWS APIs. Retrieve the top 50 highest-severity active findings across all regions. Group the findings by resource type (EC2, IAM, S3, EKS) and threat purpose (e.g., Backdoor, CryptoCurrency, CredentialAccess). Present the results in a structured table to help identify active attack campaigns.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:ListFindings","guardduty:GetFindings"],
      },
      {
        icon: Map,
        label: "Coverage Gap Analysis",
        prompt: "Run a full GuardDuty coverage gap analysis across all AWS regions using real AWS API calls. For every region, check if a GuardDuty detector exists and is enabled. For enabled detectors, verify the status of S3 Protection, EKS Protection, RDS Protection, Lambda Network Protection, and Malware Protection. Report any region or feature that is disabled as a security gap.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:GetDetector"],
      },
      {
        icon: Bug,
        label: "Malware Scans",
        prompt: "Audit GuardDuty Malware Protection status using real AWS API calls. Check the malware scanning configuration on the primary detector. Identify any EC2 instances or EBS volumes that have generated 'Execution:EC2/MaliciousFile' or similar malware findings recently. Provide the exact resource IDs and the remediation steps to isolate them.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:GetMalwareScanSettings","guardduty:ListFindings"],
      },
      {
        icon: ShieldAlert,
        label: "EKS & Container Threats",
        prompt: "Analyze GuardDuty for Kubernetes and container-specific threats using real AWS APIs. Query active findings specifically related to EKS clusters, such as 'PrivilegeEscalation:Kubernetes', 'CredentialAccess:Kubernetes', or 'Execution:Kubernetes'. List the affected cluster names, namespaces, and pod names involved in the suspicious activity.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:ListFindings","guardduty:GetFindings"],
      },
      {
        icon: KeyRound,
        label: "IAM Credential Theft",
        prompt: "Investigate potential IAM credential compromise using GuardDuty findings via real AWS APIs. Query for findings like 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration', 'PenTest:IAMUser/KaliLinux', or 'Stealth:IAMUser/CloudTrailLoggingDisabled'. Identify the specific IAM users or roles involved and generate the CLI commands to immediately revoke their active sessions.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:ListFindings","guardduty:GetFindings","iam:UpdateAccessKey"],
      },
    ],
  },
  {
    label: "REMEDIATION",
    color: "text-yellow-400",
    actions: [
      {
        icon: Globe,
        label: "Close Public Access",
        prompt: "Identify and remediate all public access vectors using real AWS API calls. Query: S3 buckets with public access (get real bucket names), security groups with 0.0.0.0/0 (get real group IDs and rule details), RDS instances with PubliclyAccessible=true (get real DB identifiers), EC2 instances with public IPs attached to sensitive roles. For each real finding, provide the exact AWS CLI remediation command targeting that specific resource ID.",
        requiredPermissions: ["s3:ListAllMyBuckets","ec2:DescribeSecurityGroups","rds:DescribeDBInstances","ec2:DescribeInstances"],
      },
      {
        icon: AlertTriangle,
        label: "SG Preview 443",
        prompt: "Open port 443 to 0.0.0.0/0 on the security group prod-web-sg. Preview the exact rule change and risk level first, and do not apply anything until I confirm.",
        requiredPermissions: ["ec2:DescribeSecurityGroups"],
      },
      {
        icon: Network,
        label: "SG-to-SG Preview",
        prompt: "Allow the security group app-sg to reach db-sg on TCP port 5432. Show the exact security group rule preview and wait for confirmation before applying.",
        requiredPermissions: ["ec2:DescribeSecurityGroups"],
      },
      {
        icon: Ban,
        label: "SG Block Test",
        prompt: "Open port 22 to 0.0.0.0/0 on the security group prod-web-sg.",
        requiredPermissions: ["ec2:AuthorizeSecurityGroupIngress"],
      },
      {
        icon: Globe,
        label: "SG Egress Preview",
        prompt: "Allow outbound HTTPS traffic to 0.0.0.0/0 from the security group app-sg. Preview the exact egress rule and risk level first, and do not apply anything until I confirm.",
        requiredPermissions: ["ec2:DescribeSecurityGroups"],
      },
      {
        icon: ShieldCheck,
        label: "SG Revoke Egress",
        prompt: "Remove outbound HTTPS access to 0.0.0.0/0 from the security group app-sg. Show the exact egress rule preview and wait for confirmation before applying.",
        requiredPermissions: ["ec2:DescribeSecurityGroups","ec2:RevokeSecurityGroupEgress"],
      },
      {
        icon: ShieldCheck,
        label: "Confirm Change",
        prompt: "Confirm",
        requiredPermissions: [],
      },
      {
        icon: Archive,
        label: "Capture Baseline",
        prompt: "Capture a confirmed-good baseline for my AWS account covering security groups, IAM users, and S3 buckets.",
        requiredPermissions: ["ec2:DescribeSecurityGroups","iam:GetAccountAuthorizationDetails","s3:ListAllMyBuckets"],
      },
      {
        icon: Shield,
        label: "Org SCP Preview",
        prompt: "Apply the deny-non-approved-regions SCP to all dev accounts in the organization. Allow only us-east-1 and eu-west-1. Show a formal preview with the exact account count, env breakdown, warnings, and the confirmation phrase required before executing.",
        requiredPermissions: ["organizations:ListAccounts"],
      },
      {
        icon: Users,
        label: "Guardian Role Status",
        prompt: "Which accounts have GuardianRole missing? Run a formal organization-wide onboarding status query and identify every account where GuardianExecutionRole cannot be assumed.",
        requiredPermissions: ["organizations:ListAccounts","sts:AssumeRole"],
      },
      {
        icon: Bot,
        label: "S3 Lockdown Runbook",
        prompt: "Run the public S3 lockdown playbook for customer-data-bucket. Show the formal step plan first and wait for me to say run playbook before executing.",
        requiredPermissions: ["s3:GetBucketPublicAccessBlock"],
      },
      {
        icon: Shield,
        label: "Enable GuardDuty",
        prompt: "Check GuardDuty status across regions and generate enablement commands. Use real AWS API calls to: query GuardDuty detector status in the current region and adjacent regions (us-east-1, us-west-2, eu-west-1), check if S3 protection, EKS protection, Lambda protection, and RDS protection are enabled on existing detectors. For each gap found, provide the exact AWS CLI command to enable that protection.",
        requiredPermissions: ["guardduty:ListDetectors","guardduty:CreateDetector"],
      },
      {
        icon: Lock,
        label: "Enforce MFA",
        prompt: "Enforce MFA across all IAM users using real API calls. Query: all IAM users, list which have MFA devices (ListMFADevices), identify users with console access and no MFA. Generate: an IAM policy that denies all actions except MFA enrollment unless MFA is present (with exact JSON), and the AWS CLI commands to attach that policy. Show real usernames from the account that need MFA enforcement.",
        requiredPermissions: ["iam:ListUsers","iam:ListMFADevices","iam:CreatePolicy","iam:AttachUserPolicy"],
      },
      {
        icon: Key,
        label: "IAM S3 Preview",
        prompt: "Give the IAM group dev-team read-only S3 access. Preview the exact IAM policy first, do not apply anything until I confirm.",
        requiredPermissions: ["iam:GetGroup"],
      },
      {
        icon: Users,
        label: "IAM Scoped Preview",
        prompt: "Prepare a least-privilege IAM policy to give the IAM group contractor-group read-only S3 access to arn:aws:s3:::example-bucket and arn:aws:s3:::example-bucket/* only. Show the preview and wait for confirmation.",
        requiredPermissions: ["iam:GetGroup"],
      },
      {
        icon: Cpu,
        label: "Harden IMDSv2",
        prompt: "Enforce IMDSv2 across all EC2 instances using real API calls. Query all instances and their MetadataOptions (HttpTokens setting). For each instance with HttpTokens=optional (IMDSv1 enabled), provide the exact AWS CLI command to enforce IMDSv2: aws ec2 modify-instance-metadata-options. Also check launch templates for IMDSv1 defaults and provide the commands to update them. Show real instance IDs.",
        requiredPermissions: ["ec2:DescribeInstances","ec2:ModifyInstanceMetadataOptions"],
      },
      {
        icon: Bot,
        label: "Task Automator",
        prompt: "Automate remediation execution using real AWS API calls. Review findings from Security Hub or GuardDuty, map them to standard runbooks, and provide the exact AWS CLI automation commands to remediate the specific issues identified (e.g., closing public buckets, restricting security groups).",
        requiredPermissions: ["securityhub:GetFindings","guardduty:ListFindings"],
      },
      {
        icon: Bell,
        label: "Set $200 Budget Rule",
        prompt: "Alert me if daily spend exceeds $200.",
        requiredPermissions: ["budgets:ModifyBudget"],
      },
      {
        icon: BarChart3,
        label: "Auto-Stop Idle EC2",
        prompt: "Shut down idle EC2 instances if EC2 spend exceeds $150/day.",
        requiredPermissions: ["ce:GetCostAndUsage","ec2:StopInstances"],
      },
    ],
  },
  {
    label: "REPORTING & ALERTS",
    color: "text-purple-400",
    actions: [
      {
        icon: ClipboardList,
        label: "Report Builder",
        prompt: "Format security findings into detailed payload reports. Query recent assessments from Security Hub and GuardDuty, synthesize the results, and generate a structured HTML/Markdown report summarizing the current security posture.",
        requiredPermissions: ["securityhub:GetFindings","guardduty:ListFindings"],
      },
      {
        icon: BellRing,
        label: "Severity Alerts",
        prompt: "Review severity-tiered alert configurations using real AWS APIs. Check SNS topics and Lambda trigger subscriptions associated with Security Hub or GuardDuty events to ensure Critical/High/Medium/Low alerts are routed correctly.",
        requiredPermissions: ["sns:ListTopics","sns:ListSubscriptionsByTopic","lambda:ListFunctions"],
      },
      {
        icon: Archive,
        label: "Audit Archive",
        prompt: "Check audit reporting infrastructure using real AWS APIs. Verify DynamoDB history tables for security audit logs and check S3 bucket policies for the report archive bucket to ensure write-once-read-many (WORM) or object lock configurations are active.",
        requiredPermissions: ["dynamodb:ListTables","s3:GetBucketObjectLockConfiguration"],
      },
      {
        icon: Mail,
        label: "Email Engine",
        prompt: "Audit the email alert engine configuration using real AWS APIs. Check AWS SES (Simple Email Service) domain identities, verified email addresses, sending statistics, and review SNS-to-Email subscription configurations for escalation rules.",
        requiredPermissions: ["ses:ListIdentities","ses:GetIdentityVerificationAttributes","sns:ListSubscriptions"],
      },
    ],
  },
  {
    label: "CLOUDWATCH",
    color: "text-cyan-400",
    actions: [
      {
        icon: Bell,
        label: "Security Alarms",
        prompt: "Create CloudWatch Alarms for critical security events using real AWS API calls. Set up alarms for: unauthorized API calls, root account usage, IAM policy changes, security group modifications, NACL changes, console sign-in failures, S3 bucket policy changes, CloudTrail configuration changes, and KMS key deletion. Create the corresponding metric filters on the CloudTrail log group and link alarms to the configured SNS topic for email notifications.",
        requiredPermissions: ["cloudwatch:PutMetricAlarm","logs:PutMetricFilter"],
      },
      {
        icon: Gauge,
        label: "Anomaly Detection",
        prompt: "Configure CloudWatch Anomaly Detection for security monitoring using real AWS API calls. Set up anomaly detectors for: API call volume per principal, EC2 instance launch frequency, IAM user creation rate, S3 data transfer volumes, and cross-region API activity. Create anomaly detection alarms that trigger when metrics exceed the expected band by 2+ standard deviations. Report the current anomaly detection configuration and any active anomalies detected.",
        requiredPermissions: ["cloudwatch:PutAnomalyDetector","cloudwatch:PutMetricAlarm"],
      },
      {
        icon: ScrollText,
        label: "Log Insights",
        prompt: "Run CloudWatch Logs Insights queries against CloudTrail logs using real AWS API calls. Execute queries for: top 10 denied API calls in the last 24 hours with source IPs, unusual console logins by geolocation, API calls from previously unseen IP addresses, resource deletion events across all services, and IAM credential usage patterns. Present results in structured tables with timestamps and affected resources.",
        requiredPermissions: ["logs:StartQuery","logs:GetQueryResults"],
      },
      {
        icon: BarChart3,
        label: "Metric Filters",
        prompt: "Audit and create CloudWatch Metric Filters on CloudTrail log groups using real AWS API calls. Check existing metric filters and identify gaps. Create filters for: unauthorized access attempts, root account activity, IAM policy modifications, security group changes, S3 bucket exposure events, and failed authentication attempts. Show the filter patterns, metric namespaces, and linked alarms.",
        requiredPermissions: ["logs:DescribeMetricFilters","logs:PutMetricFilter"],
      },
      {
        icon: LayoutDashboard,
        label: "Security Dashboard",
        prompt: "Design a CloudWatch Security Dashboard configuration using real AWS API calls. Query current alarms, metrics, and log groups to determine available data sources. Generate a dashboard JSON definition with widgets for: alarm status overview, API call volume trends, unauthorized access attempt graphs, top security findings, geographic API activity distribution, and resource change timeline. Provide the AWS CLI command to create the dashboard.",
        requiredPermissions: ["cloudwatch:PutDashboard"],
      },
      {
        icon: Activity,
        label: "Alarm Status",
        prompt: "Query all CloudWatch Alarms related to security monitoring using real AWS API calls. List every alarm with its current state (OK, ALARM, INSUFFICIENT_DATA), the metric it monitors, threshold configuration, evaluation period, and linked SNS actions. Identify any alarms in ALARM state and provide the triggering metric data. Also identify critical security events that lack alarm coverage.",
        requiredPermissions: ["cloudwatch:DescribeAlarms"],
      },
    ],
  },
];

const categoryBorderColors: Record<string, string> = {
  "AUDIT": "border-blue-500/20",
  "COMPLIANCE": "border-green-500/20",
  "ATTACK SIMULATION": "border-red-500/20",
  "INCIDENT RESPONSE": "border-orange-500/20",
  "REMEDIATION": "border-yellow-500/20",
  "GUARDDUTY": "border-pink-500/20",
  "REPORTING & ALERTS": "border-purple-500/20",
  "CLOUDWATCH": "border-cyan-500/20",
};

const QuickActions = ({ onAction, disabled, credentials }: QuickActionsProps) => {
  const [selectedAction, setSelectedAction] = useState<QuickActionItem | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    AUDIT: false,
    COMPLIANCE: true,
    "ATTACK SIMULATION": true,
    "INCIDENT RESPONSE": true,
    GUARDDUTY: true,
    REMEDIATION: true,
    "REPORTING & ALERTS": true,
    CLOUDWATCH: true,
  });

  const toggleCategory = (label: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [label]: !prev[label]
    }));
  };

  const handleActionClick = (action: QuickActionItem) => {
    setSelectedAction(action);
  };

  const confirmAction = () => {
    if (selectedAction) {
      onAction(selectedAction.prompt);
      setSelectedAction(null);
    }
  };

  return (
    <>
    <div className="space-y-4">
      {categories.map((cat) => {
        const isCollapsed = collapsedCategories[cat.label] ?? false;
        return (
          <div key={cat.label} className={`rounded-lg border ${categoryBorderColors[cat.label] ?? "border-border"} bg-card/40 overflow-hidden transition-all duration-200`}>
            <button
              type="button"
              onClick={() => toggleCategory(cat.label)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors focus:outline-none"
            >
              <span className={`text-[10px] font-mono tracking-widest uppercase font-semibold ${cat.color}`}>
                {cat.label}
              </span>
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" />
              )}
            </button>
            
            {!isCollapsed && (
              <div className="p-3 pt-0 border-t border-border/10 animate-fade-in">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
                  {cat.actions.map((action) => {
                    const mode = action.recommendedMode || "fast";
                    return (
                      <Tooltip key={action.label}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="action"
                            size="xs"
                            onClick={() => handleActionClick(action as QuickActionItem)}
                            disabled={disabled}
                            className="flex items-center gap-1.5 justify-start h-auto py-2 px-2.5 text-left w-full"
                          >
                            <action.icon className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{action.label}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs bg-card border-border p-2.5 text-xs shadow-xl space-y-1 z-50">
                          <div className="flex items-center gap-1.5 font-bold text-xs">
                            {mode === "deep" ? (
                              <>
                                <DeepAuditIcon className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-blue-400">🔍 Deep Audit Recommended</span>
                              </>
                            ) : (
                              <>
                                <FastScanIcon className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400">⚡ Fast Scan Optimal</span>
                              </>
                            )}
                          </div>
                          <p className="text-muted-foreground text-[11px] leading-relaxed">
                            {action.recommendationReason || (mode === "deep"
                              ? "Multi-pass recursive analysis recommended for full attack path mapping."
                              : "Single-pass execution handles this query fast (~2–5s).")}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
      {selectedAction && (
        <QuickActionPermissionsDialog
          open={!!selectedAction}
          onOpenChange={(open) => !open && setSelectedAction(null)}
          prompt={selectedAction.prompt}
          actionLabel={selectedAction.label}
          requiredPermissions={selectedAction.requiredPermissions}
          credentials={credentials || null}
          onConfirm={confirmAction}
          recommendedMode={selectedAction.recommendedMode}
          recommendationReason={selectedAction.recommendationReason}
        />
      )}
    </>
  );
};

export default QuickActions;
