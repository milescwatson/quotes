variable "account_id" {
  type        = string
  description = "Verified numeric ID of quotes-development. Never use a different account."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Supply the verified 12-digit development account ID."
  }
}
variable "region" {
  type    = string
  default = "us-west-2"
}
variable "notification_email" {
  type    = string
  default = null
}
variable "repository_url" {
  type        = string
  default     = null
  description = "Set to https://github.com/milescwatson/quotes after the Amplify GitHub connection is authorized."
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = { Application = "quotes", Environment = "development", ManagedBy = "terraform" }
  }
}
module "quotes" {
  source             = "../../modules/quotes"
  environment        = "development"
  branch_name        = "development"
  region             = var.region
  account_id         = var.account_id
  repository_url     = var.repository_url
  notification_email = var.notification_email
}
output "deployment" { value = module.quotes.deployment }
