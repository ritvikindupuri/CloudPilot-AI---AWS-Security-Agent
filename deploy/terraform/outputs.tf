output "agent_lambda_arn" {
  description = "ARN of the deployed CloudPilot In-VPC Mini Agent Lambda"
  value       = aws_lambda_function.in_vpc_agent.arn
}

output "agent_role_arn" {
  description = "ARN of the IAM role assumed by the agent"
  value       = aws_iam_role.lambda_exec.arn
}

output "eventbridge_rule_arn" {
  description = "ARN of the EventBridge rule capturing security mutations"
  value       = aws_cloudwatch_event_rule.security_events.arn
}

output "sns_alerts_topic_arn" {
  description = "ARN of the SNS topic for real-time security alerts"
  value       = aws_sns_topic.alerts.arn
}
