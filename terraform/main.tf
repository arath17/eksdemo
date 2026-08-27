module "vpc" {
  source = "./modules/vpc"

  name               = var.cluster_name
  cidr               = var.vpc_cidr
  availability_zones = var.availability_zones
  environment        = var.environment
}

module "ecr" {
  source = "./modules/ecr"

  name        = var.cluster_name
  environment = var.environment
}

module "eks" {
  source = "./modules/eks"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.public_subnet_ids
  environment     = var.environment

  node_instance_types = var.node_instance_types
  node_capacity_type  = var.node_capacity_type
  node_min_size       = var.node_min_size
  node_max_size       = var.node_max_size
  node_desired_size   = var.node_desired_size

  github_actions_role_arn = module.iam.github_actions_role_arn
}

module "iam" {
  source = "./modules/iam"

  name          = var.cluster_name
  github_org    = var.github_org
  github_repo   = var.github_repo
  github_branch = var.github_branch
  environment   = var.environment

  ecr_repository_arn     = module.ecr.repository_arn
  cluster_name           = module.eks.cluster_name
  terraform_state_bucket = var.backend_bucket
  terraform_lock_table   = var.backend_dynamodb_table
}

# EKS managed add-on: metrics-server (required for HPA).
resource "aws_eks_addon" "metrics_server" {
  cluster_name  = module.eks.cluster_name
  addon_name    = "metrics-server"
  addon_version = "v0.7.2-eksbuild.1"

  depends_on = [module.eks]
}

