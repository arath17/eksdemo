variable "name" {
  description = "Name prefix for IAM resources"
  type        = string
}

variable "github_org" {
  description = "GitHub organization or user name"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "github_branch" {
  description = "GitHub branch allowed to assume the deploy role"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "ecr_repository_arn" {
  description = "ARN of the ECR repository"
  type        = string
  default     = ""
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "terraform_state_bucket" {
  description = "S3 bucket used for Terraform state"
  type        = string
}

variable "terraform_lock_table" {
  description = "DynamoDB table used for Terraform state locking"
  type        = string
}
