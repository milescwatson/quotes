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
