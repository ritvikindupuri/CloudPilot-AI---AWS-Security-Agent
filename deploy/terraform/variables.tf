variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region to deploy the CloudPilot In-VPC Agent into"
}

variable "vpc_id" {
  type        = string
  description = "The target VPC ID where the agent Lambda runs"
}

variable "subnet_ids" {
  type        = list(string)
  description = "List of private subnet IDs with outbound internet connectivity"
}

variable "cloudpilot_endpoint" {
  type        = string
  default     = "https://api.cloudpilot.ai"
  description = "CloudPilot AI Dashboard telemetry endpoint"
}

variable "cloudpilot_api_key" {
  type        = string
  sensitive   = true
  description = "CloudPilot AI Agent API key for authenticated telemetry ingestion"
}

variable "auto_remediation_enabled" {
  type        = bool
  default     = true
  description = "Enable automatic remediation of high-risk security drift"
}

variable "notification_email" {
  type        = string
  default     = ""
  description = "Optional email address for immediate SNS security alerts"
}
