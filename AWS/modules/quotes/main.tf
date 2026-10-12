terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}
locals {
  name         = "quotes-${var.environment}"
  frontend_url = "https://${var.branch_name}.${aws_amplify_app.frontend.default_domain}"
  cognito_url  = "https://${aws_cognito_user_pool_domain.app.domain}.auth.${var.region}.amazoncognito.com"
}
resource "aws_dsql_cluster" "app" {
  deletion_protection_enabled = true
  tags                        = { Name = local.name }
  lifecycle { prevent_destroy = true }
}
resource "aws_amplify_app" "frontend" {
  name                        = local.name
  platform                    = "WEB_COMPUTE"
  repository                  = var.repository_url
  enable_branch_auto_build    = true
  enable_auto_branch_creation = false
  enable_branch_auto_deletion = false
  iam_service_role_arn        = aws_iam_role.amplify.arn
  build_spec                  = file("${path.module}/../../../amplify.yml")
  environment_variables = { NITRO_PRESET = "aws-amplify" }
  lifecycle { ignore_changes = [access_token, oauth_token] }
}
resource "aws_amplify_branch" "frontend" {
  app_id                      = aws_amplify_app.frontend.id
  branch_name                 = var.branch_name
  stage                       = "DEVELOPMENT"
  framework                   = "Nuxt"
  enable_auto_build           = true
  enable_pull_request_preview = false
  environment_variables = {
    AMPLIFY_MONOREPO_APP_ROOT        = "app"
    NUXT_PUBLIC_API_BASE             = aws_apigatewayv2_api.api.api_endpoint
    NUXT_PUBLIC_COGNITO_USER_POOL_ID = aws_cognito_user_pool.app.id
    NUXT_PUBLIC_COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
    NUXT_PUBLIC_COGNITO_DOMAIN       = local.cognito_url
  }
}
resource "aws_iam_role" "amplify" {
  name               = "${local.name}-amplify"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "amplify.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = var.account_id }, ArnLike = { "aws:SourceArn" = "arn:aws:amplify:${var.region}:${var.account_id}:apps/*" } } }] })
}
resource "aws_iam_role_policy" "amplify_logs" {
  role   = aws_iam_role.amplify.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/amplify/*" }] })
}
resource "aws_cognito_user_pool" "app" {
  name                     = local.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  admin_create_user_config { allow_admin_create_user_only = false }
  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
  deletion_protection = "ACTIVE"
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_user_pool_domain" "app" {
  domain       = "${local.name}-${var.account_id}"
  user_pool_id = aws_cognito_user_pool.app.id
}
resource "aws_cognito_resource_server" "api" {
  identifier   = "quotes-api"
  name         = "Quotes API"
  user_pool_id = aws_cognito_user_pool.app.id
  scope {
    scope_name        = "access"
    scope_description = "Access the Quotes API"
  }
}
resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${local.name}-web"
  user_pool_id                         = aws_cognito_user_pool.app.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "quotes-api/access"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${local.frontend_url}/auth/callback", "http://localhost:3000/auth/callback"]
  logout_urls                          = [local.frontend_url, "http://localhost:3000"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  depends_on                           = [aws_cognito_resource_server.api]
}
resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "api" {
  role = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.api.arn}:*" },
    { Effect = "Allow", Action = ["dsql:DbConnect"], Resource = aws_dsql_cluster.app.arn }
  ] })
}
data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../../../server/dist"
  output_path = "${path.root}/.terraform/quotes-api.zip"
}
resource "aws_lambda_function" "api" {
  function_name                  = "${local.name}-api"
  role                           = aws_iam_role.api.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = data.archive_file.api.output_path
  source_code_hash               = data.archive_file.api.output_base64sha256
  memory_size                    = 512
  timeout                        = 15
  reserved_concurrent_executions = -1
  publish                        = true
  environment { variables = {
    ENVIRONMENT       = var.environment
    DSQL_CLUSTER_ID   = aws_dsql_cluster.app.identifier
    DSQL_ENDPOINT     = "${aws_dsql_cluster.app.identifier}.dsql.${var.region}.on.aws"
    DSQL_USER         = "quotes_api"
    COGNITO_ISSUER    = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.app.id}"
    COGNITO_CLIENT_ID = aws_cognito_user_pool_client.web.id
    COGNITO_DOMAIN    = local.cognito_url
  } }
  depends_on = [aws_iam_role_policy.api]
}
resource "aws_lambda_alias" "api" {
  name             = var.environment
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}
resource "aws_apigatewayv2_api" "api" {
  description      = "Quotes identity, organization, quote, and taxonomy API."
  version          = "0.3.0"
  name             = local.name
  protocol_type    = "HTTP"
  fail_on_warnings = true
  body             = local.openapi
  # The provider also manages CORS as a top-level API setting. Derive it
  # from OpenAPI so UpdateApi cannot clear the imported configuration.
  cors_configuration {
    allow_origins = local.cors.allowOrigins
    allow_methods = local.cors.allowMethods
    allow_headers = local.cors.allowHeaders
    max_age       = local.cors.maxAge
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowQuotesApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  qualifier     = aws_lambda_alias.api.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = 14
}
resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn
    format          = jsonencode({ requestId = "$context.requestId", routeKey = "$context.routeKey", status = "$context.status", responseLength = "$context.responseLength", integrationError = "$context.integrationErrorMessage" })
  }
}
output "deployment" {
  value = {
    frontend_url         = local.frontend_url
    amplify_app_id       = aws_amplify_app.frontend.id
    amplify_branch       = aws_amplify_branch.frontend.branch_name
    api_url              = aws_apigatewayv2_api.api.api_endpoint
    dsql_cluster_id      = aws_dsql_cluster.app.identifier
    dsql_cluster_arn     = aws_dsql_cluster.app.arn
    api_role_arn         = aws_iam_role.api.arn
    cognito_user_pool_id = aws_cognito_user_pool.app.id
    cognito_client_id    = aws_cognito_user_pool_client.web.id
  }
}

locals {
  openapi = templatefile("${path.module}/../../openapi.yaml", {
    api_name          = local.name
    lambda_invoke_arn = aws_lambda_alias.api.invoke_arn
    issuer            = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.app.id}"
    client_id         = aws_cognito_user_pool_client.web.id
    authorization_url = "${local.cognito_url}/oauth2/authorize"
    token_url         = "${local.cognito_url}/oauth2/token"
    frontend_url      = local.frontend_url
  })
  cors = yamldecode(local.openapi)["x-amazon-apigateway-cors"]
}
