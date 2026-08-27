locals {
  github_oidc_url   = "https://token.actions.githubusercontent.com"
  oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

# Create the GitHub OIDC provider if it does not already exist.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url = local.github_oidc_url

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = [
    "6938fd4e98bab03faadb97b34396831e3780aea1", # GitHub Actions default thumbprint
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd", # Secondary GitHub thumbprint
  ]

  tags = {
    Environment = var.environment
    Project     = var.name
  }
}

# Look up the existing GitHub OIDC provider when we are not creating it.
data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = local.github_oidc_url
}

# IAM role assumed by GitHub Actions via OIDC.
resource "aws_iam_role" "github_actions" {
  name = "${var.name}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = local.oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          "ForAnyValue:StringLike" = {
            "token.actions.githubusercontent.com:sub" = [
              # Legacy format (repositories created before July 15, 2026)
              "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_branch}",
              # Immutable format (repositories created after July 15, 2026)
              "repo:${var.github_org}@*/${var.github_repo}@*:ref:refs/heads/${var.github_branch}",
            ]
          }
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Project     = var.name
  }
}

# Policy for ECR push/pull.
resource "aws_iam_policy" "ecr" {
  name        = "${var.name}-github-actions-ecr"
  description = "Allow GitHub Actions to push and pull ECR images"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = "*"
      }
    ]
  })
}

# Policy for EKS access.
resource "aws_iam_policy" "eks" {
  name        = "${var.name}-github-actions-eks"
  description = "Allow GitHub Actions to interact with the EKS cluster"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "eks:DescribeCluster",
          "eks:ListClusters",
        ]
        Resource = "*"
      }
    ]
  })
}

# Policy for Terraform state backend.
resource "aws_iam_policy" "terraform_state" {
  name        = "${var.name}-github-actions-tfstate"
  description = "Allow GitHub Actions to read and write Terraform state"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketVersioning",
        ]
        Resource = "arn:aws:s3:::${var.terraform_state_bucket}"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "arn:aws:s3:::${var.terraform_state_bucket}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
        ]
        Resource = "arn:aws:dynamodb:*:*:table/${var.terraform_lock_table}"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_ecr" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.ecr.arn
}

resource "aws_iam_role_policy_attachment" "github_actions_eks" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.eks.arn
}

resource "aws_iam_role_policy_attachment" "github_actions_terraform_state" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.terraform_state.arn
}

# Attach AdministratorAccess for the demo so Terraform can manage all resources.
# In production, replace this with least-privilege policies scoped to the resources.
resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}


