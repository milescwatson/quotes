variable "environment" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "repository_url" {
  type    = string
  default = null
}
variable "branch_name" {
  type    = string
  default = "main"
}
variable "notification_email" {
  type    = string
  default = null
}
variable "monthly_budget_usd" {
  type    = number
  default = 25
}

variable "api_reserved_concurrent_executions" {
  type        = number
  default     = -1
  description = "Use zero to keep API traffic paused during a coordinated schema/API release."
  validation {
    condition     = var.api_reserved_concurrent_executions >= -1 && floor(var.api_reserved_concurrent_executions) == var.api_reserved_concurrent_executions
    error_message = "Use -1 for unreserved concurrency, zero for maintenance, or a positive whole number."
  }
}
