module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.13.0"

  name = var.name
  cidr = var.cidr

  azs             = var.availability_zones
  public_subnets  = [for i, az in var.availability_zones : cidrsubnet(var.cidr, 8, i)]
  private_subnets = []

  enable_nat_gateway = false
  enable_vpn_gateway = false

  enable_dns_hostnames = true
  enable_dns_support   = true

  map_public_ip_on_launch = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
    Type                     = "public"
  }

  tags = {
    Environment = var.environment
    Project     = var.name
  }
}
