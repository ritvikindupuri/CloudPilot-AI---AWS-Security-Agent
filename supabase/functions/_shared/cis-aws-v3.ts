/**
 * CIS AWS Foundations Benchmark v3.0.0 Control Mappings
 * Complete control catalog with IDs, titles, and check operations
 */

export interface CISControl {
  id: string;
  section: string;
  title: string;
  level: 1 | 2;
  checkOperation?: string; // AWS API operation used to check this control
  service: string;
  description?: string;
}

export const CIS_AWS_V3_CONTROLS: Record<string, CISControl> = {
  // Section 1: Identity and Access Management
  "1.1": {
    id: "1.1",
    section: "IAM",
    title: "Maintain current contact details",
    level: 1,
    service: "Account",
  },
  "1.2": {
    id: "1.2",
    section: "IAM",
    title: "Ensure security contact information is registered",
    level: 1,
    service: "Account",
  },
  "1.3": {
    id: "1.3",
    section: "IAM",
    title: "Ensure security questions are registered in the AWS account",
    level: 1,
    service: "Account",
  },
  "1.4": {
    id: "1.4",
    section: "IAM",
    title: "Ensure no 'root' user account access key exists",
    level: 1,
    checkOperation: "GetAccountSummary",
    service: "IAM",
  },
  "1.5": {
    id: "1.5",
    section: "IAM",
    title: "Ensure MFA is enabled for the 'root' user account",
    level: 1,
    checkOperation: "GetAccountSummary",
    service: "IAM",
  },
  "1.6": {
    id: "1.6",
    section: "IAM",
    title: "Ensure hardware MFA is enabled for the 'root' user account",
    level: 2,
    checkOperation: "GetAccountSummary",
    service: "IAM",
  },
  "1.7": {
    id: "1.7",
    section: "IAM",
    title: "Eliminate use of the 'root' user for administrative and daily tasks",
    level: 1,
    checkOperation: "GetCredentialReport",
    service: "IAM",
  },
  "1.8": {
    id: "1.8",
    section: "IAM",
    title: "Ensure IAM password policy requires minimum length of 14 or greater",
    level: 1,
    checkOperation: "GetAccountPasswordPolicy",
    service: "IAM",
  },
  "1.9": {
    id: "1.9",
    section: "IAM",
    title: "Ensure IAM password policy prevents password reuse",
    level: 1,
    checkOperation: "GetAccountPasswordPolicy",
    service: "IAM",
  },
  "1.10": {
    id: "1.10",
    section: "IAM",
    title: "Ensure multi-factor authentication (MFA) is enabled for all IAM users that have a console password",
    level: 1,
    checkOperation: "ListUsers, ListMFADevices, GetLoginProfile",
    service: "IAM",
  },
  "1.11": {
    id: "1.11",
    section: "IAM",
    title: "Do not setup access keys during initial user setup for all IAM users that have a console password",
    level: 1,
    checkOperation: "ListUsers, ListAccessKeys",
    service: "IAM",
  },
  "1.12": {
    id: "1.12",
    section: "IAM",
    title: "Ensure credentials unused for 45 days or greater are disabled",
    level: 1,
    checkOperation: "GetCredentialReport",
    service: "IAM",
  },
  "1.13": {
    id: "1.13",
    section: "IAM",
    title: "Ensure there is only one active access key available for any single IAM user",
    level: 1,
    checkOperation: "ListUsers, ListAccessKeys",
    service: "IAM",
  },
  "1.14": {
    id: "1.14",
    section: "IAM",
    title: "Ensure access keys are rotated every 90 days or less",
    level: 1,
    checkOperation: "GetCredentialReport",
    service: "IAM",
  },
  "1.15": {
    id: "1.15",
    section: "IAM",
    title: "Ensure IAM Users Receive Permissions Only Through Groups",
    level: 1,
    checkOperation: "ListUsers, ListAttachedUserPolicies, ListUserPolicies",
    service: "IAM",
  },
  "1.16": {
    id: "1.16",
    section: "IAM",
    title: "Ensure IAM policies that allow full \"*:*\" administrative privileges are not attached",
    level: 1,
    checkOperation: "GetAccountAuthorizationDetails",
    service: "IAM",
  },
  "1.17": {
    id: "1.17",
    section: "IAM",
    title: "Ensure a support role has been created to manage incidents with AWS Support",
    level: 1,
    checkOperation: "ListPolicies, GetPolicy",
    service: "IAM",
  },
  "1.18": {
    id: "1.18",
    section: "IAM",
    title: "Ensure IAM instance roles are used for AWS resource access from instances",
    level: 2,
    checkOperation: "DescribeInstances",
    service: "EC2",
  },
  "1.19": {
    id: "1.19",
    section: "IAM",
    title: "Ensure that all the expired SSL/TLS certificates stored in AWS IAM are removed",
    level: 1,
    checkOperation: "ListServerCertificates",
    service: "IAM",
  },
  "1.20": {
    id: "1.20",
    section: "IAM",
    title: "Ensure that IAM Access analyzer is enabled for all regions",
    level: 2,
    checkOperation: "ListAnalyzers",
    service: "AccessAnalyzer",
  },
  "1.21": {
    id: "1.21",
    section: "IAM",
    title: "Ensure IAM users are managed centrally via identity federation or AWS Organizations for multi-account environments",
    level: 2,
    service: "IAM",
  },
  "1.22": {
    id: "1.22",
    section: "IAM",
    title: "Ensure access to AWSCloudShellFullAccess is restricted",
    level: 1,
    checkOperation: "ListPolicies, GetPolicyVersion, ListEntitiesForPolicy",
    service: "IAM",
  },

  // Section 2: Storage
  "2.1.1": {
    id: "2.1.1",
    section: "S3",
    title: "Ensure S3 Bucket Policy is set to deny HTTP requests",
    level: 2,
    checkOperation: "GetBucketPolicy",
    service: "S3",
  },
  "2.1.2": {
    id: "2.1.2",
    section: "S3",
    title: "Ensure MFA Delete is enabled on S3 buckets",
    level: 2,
    checkOperation: "GetBucketVersioning",
    service: "S3",
  },
  "2.1.3": {
    id: "2.1.3",
    section: "S3",
    title: "Ensure all data in Amazon S3 has been discovered, classified and secured when required",
    level: 2,
    service: "S3",
  },
  "2.1.4": {
    id: "2.1.4",
    section: "S3",
    title: "Ensure that S3 Buckets are configured with 'Block public access (bucket settings)'",
    level: 1,
    checkOperation: "GetPublicAccessBlock",
    service: "S3",
  },
  "2.2.1": {
    id: "2.2.1",
    section: "EBS",
    title: "Ensure EBS volume encryption is enabled in all regions",
    level: 1,
    checkOperation: "GetEbsEncryptionByDefault",
    service: "EC2",
  },
  "2.3.1": {
    id: "2.3.1",
    section: "RDS",
    title: "Ensure that encryption-at-rest is enabled for RDS Instances",
    level: 2,
    checkOperation: "DescribeDBInstances",
    service: "RDS",
  },
  "2.3.2": {
    id: "2.3.2",
    section: "RDS",
    title: "Ensure Auto Minor Version Upgrade feature is Enabled for RDS Instances",
    level: 1,
    checkOperation: "DescribeDBInstances",
    service: "RDS",
  },
  "2.3.3": {
    id: "2.3.3",
    section: "RDS",
    title: "Ensure that public access is not given to RDS Instance",
    level: 1,
    checkOperation: "DescribeDBInstances",
    service: "RDS",
  },
  "2.4.1": {
    id: "2.4.1",
    section: "EFS",
    title: "Ensure that encryption is enabled for EFS file systems",
    level: 1,
    checkOperation: "DescribeFileSystems",
    service: "EFS",
  },

  // Section 3: Logging
  "3.1": {
    id: "3.1",
    section: "CloudTrail",
    title: "Ensure CloudTrail is enabled in all regions",
    level: 1,
    checkOperation: "DescribeTrails, GetTrailStatus",
    service: "CloudTrail",
  },
  "3.2": {
    id: "3.2",
    section: "CloudTrail",
    title: "Ensure CloudTrail log file validation is enabled",
    level: 2,
    checkOperation: "DescribeTrails",
    service: "CloudTrail",
  },
  "3.3": {
    id: "3.3",
    section: "Config",
    title: "Ensure AWS Config is enabled in all regions",
    level: 1,
    checkOperation: "DescribeConfigurationRecorders, DescribeConfigurationRecorderStatus",
    service: "Config",
  },
  "3.4": {
    id: "3.4",
    section: "CloudTrail",
    title: "Ensure S3 bucket access logging is enabled on the CloudTrail S3 bucket",
    level: 1,
    checkOperation: "GetBucketLogging",
    service: "S3",
  },
  "3.5": {
    id: "3.5",
    section: "CloudTrail",
    title: "Ensure CloudTrail logs are encrypted at rest using KMS CMKs",
    level: 2,
    checkOperation: "DescribeTrails",
    service: "CloudTrail",
  },
  "3.6": {
    id: "3.6",
    section: "KMS",
    title: "Ensure rotation for customer created symmetric CMKs is enabled",
    level: 2,
    checkOperation: "GetKeyRotationStatus",
    service: "KMS",
  },
  "3.7": {
    id: "3.7",
    section: "VPC",
    title: "Ensure VPC flow logging is enabled in all VPCs",
    level: 2,
    checkOperation: "DescribeFlowLogs",
    service: "EC2",
  },
  "3.8": {
    id: "3.8",
    section: "S3",
    title: "Ensure that Object-level logging for write events is enabled for S3 bucket",
    level: 2,
    checkOperation: "GetEventSelectors",
    service: "CloudTrail",
  },
  "3.9": {
    id: "3.9",
    section: "S3",
    title: "Ensure that Object-level logging for read events is enabled for S3 bucket",
    level: 2,
    checkOperation: "GetEventSelectors",
    service: "CloudTrail",
  },

  // Section 4: Monitoring
  "4.1": {
    id: "4.1",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for unauthorized API calls",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.2": {
    id: "4.2",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for Management Console sign-in without MFA",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.3": {
    id: "4.3",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for usage of 'root' account",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.4": {
    id: "4.4",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for IAM policy changes",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.5": {
    id: "4.5",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for CloudTrail configuration changes",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.6": {
    id: "4.6",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for AWS Management Console authentication failures",
    level: 2,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.7": {
    id: "4.7",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for disabling or scheduled deletion of customer managed keys",
    level: 2,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.8": {
    id: "4.8",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for S3 bucket policy changes",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.9": {
    id: "4.9",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for AWS Config configuration changes",
    level: 2,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.10": {
    id: "4.10",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for security group changes",
    level: 2,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.11": {
    id: "4.11",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for changes to Network Access Control Lists (NACL)",
    level: 2,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.12": {
    id: "4.12",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for changes to network gateways",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.13": {
    id: "4.13",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for route table changes",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.14": {
    id: "4.14",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for VPC changes",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.15": {
    id: "4.15",
    section: "CloudWatch",
    title: "Ensure a log metric filter and alarm exist for AWS Organizations changes",
    level: 1,
    checkOperation: "DescribeMetricFilters, DescribeAlarms",
    service: "CloudWatch",
  },
  "4.16": {
    id: "4.16",
    section: "SecurityHub",
    title: "Ensure AWS Security Hub is enabled",
    level: 1,
    checkOperation: "DescribeHub",
    service: "SecurityHub",
  },

  // Section 5: Networking
  "5.1": {
    id: "5.1",
    section: "VPC",
    title: "Ensure no Network ACLs allow ingress from 0.0.0.0/0 to remote server administration ports",
    level: 1,
    checkOperation: "DescribeNetworkAcls",
    service: "EC2",
  },
  "5.2": {
    id: "5.2",
    section: "SecurityGroup",
    title: "Ensure no security groups allow ingress from 0.0.0.0/0 to remote server administration ports",
    level: 1,
    checkOperation: "DescribeSecurityGroups",
    service: "EC2",
  },
  "5.3": {
    id: "5.3",
    section: "SecurityGroup",
    title: "Ensure no security groups allow ingress from ::/0 to remote server administration ports",
    level: 1,
    checkOperation: "DescribeSecurityGroups",
    service: "EC2",
  },
  "5.4": {
    id: "5.4",
    section: "SecurityGroup",
    title: "Ensure the default security group of every VPC restricts all traffic",
    level: 1,
    checkOperation: "DescribeSecurityGroups",
    service: "EC2",
  },
  "5.5": {
    id: "5.5",
    section: "VPC",
    title: "Ensure routing tables for VPC peering are 'least access'",
    level: 2,
    checkOperation: "DescribeRouteTables, DescribeVpcPeeringConnections",
    service: "EC2",
  },
  "5.6": {
    id: "5.6",
    section: "EC2",
    title: "Ensure EC2 Instance Metadata Service Version 2 (IMDSv2) is enabled",
    level: 1,
    checkOperation: "DescribeInstances",
    service: "EC2",
  },
};

/**
 * Get CIS control by ID
 */
export function getCISControl(controlId: string): CISControl | undefined {
  return CIS_AWS_V3_CONTROLS[controlId];
}

/**
 * Get all CIS controls for a section
 */
export function getCISControlsBySection(section: string): CISControl[] {
  return Object.values(CIS_AWS_V3_CONTROLS).filter(c => c.section === section);
}

/**
 * Get all CIS controls for a service
 */
export function getCISControlsByService(service: string): CISControl[] {
  return Object.values(CIS_AWS_V3_CONTROLS).filter(c => c.service === service);
}

/**
 * Validate control ID format
 */
export function isValidCISControlId(controlId: string): boolean {
  return controlId in CIS_AWS_V3_CONTROLS;
}
