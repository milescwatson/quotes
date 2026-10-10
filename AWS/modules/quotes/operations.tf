resource "aws_backup_vault" "app" {
  name          = local.name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role" "backup" {
  name               = "${local.name}-backup"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "backup.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}
resource "aws_backup_plan" "app" {
  name = local.name
  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.app.name
    schedule          = "cron(0 9 * * ? *)"
    start_window      = 60
    completion_window = 180
    lifecycle { delete_after = 7 }
  }
}
resource "aws_backup_selection" "app" {
  name         = local.name
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.app.id
  resources    = [aws_dsql_cluster.app.arn]
  depends_on   = [aws_iam_role_policy_attachment.backup]
}
resource "aws_sns_topic" "operations" { name = "${local.name}-operations" }
resource "aws_sns_topic_subscription" "email" {
  count     = var.notification_email == null ? 0 : 1
  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.notification_email
}
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.name}-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.api.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
}
resource "aws_cloudwatch_metric_alarm" "backup_failure" {
  alarm_name          = "${local.name}-backup-failure"
  namespace           = "AWS/Backup"
  metric_name         = "NumberOfBackupJobsFailed"
  dimensions          = { BackupVaultName = aws_backup_vault.app.name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
}
resource "aws_budgets_budget" "app" {
  count        = var.notification_email == null ? 0 : 1
  name         = local.name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }
}
