# Interview Prep — EKS Demo Project (Senior SRE, ~6 YoE)

Comprehensive Q&A for the Terraform + EKS demo project, ordered **Easy → Medium → Hard**,
plus observability deep-dives, incident scenarios, and live-coding tasks with solutions.

Project facts used throughout (know these cold):

- **Root** `main.tf`: 4 modules — `vpc`, `ecr`, `eks`, `iam` + `aws_eks_addon.metrics_server` (v0.7.2-eksbuild.1).
- **VPC**: `terraform-aws-modules/vpc/aws` v5.13.0, `10.0.0.0/16`, 2 AZs, **public subnets only** (`/24` each via `cidrsubnet`), **no NAT gateway**, `map_public_ip_on_launch = true`, `kubernetes.io/role/elb = 1` tag.
- **EKS**: `terraform-aws-modules/eks/aws` v20.24.0, Kubernetes **1.31**, **public API endpoint**, one managed node group `primary` — **AL2023**, `t3a.medium`, **SPOT**, min 1 / desired 1 / max 2, `CloudWatchAgentServerPolicy` attached to node role, **access entries** (API auth) granting `AmazonEKSClusterAdminPolicy` to the GitHub Actions role + extra admins.
- **IAM**: GitHub **OIDC** provider (conditionally created via `count`), role assumed via `sts:AssumeRoleWithWebIdentity`, trust locked to `repo:ORG/REPO:ref:refs/heads/main` (both legacy and new immutable `sub` formats), scoped policies for ECR push/pull, `eks:DescribeCluster/ListClusters`, S3+DynamoDB state access — **plus `AdministratorAccess` (deliberate demo shortcut, commented as such)**.
- **ECR**: tag **MUTABLE**, `scan_on_push = true`, lifecycle keeps last 30 images, `force_delete = true`.
- **State**: S3 backend + DynamoDB locking, `encrypt = true`, partial config via `backend.tfvars`.
- **Providers**: `aws ~> 5.0`, `kubernetes ~> 2.0` (exec auth via `aws eks get-token`), `tls ~> 4.0` (declared, unused at root). Terraform `>= 1.9`.

---

## 1. The "Walk me through your project" pitch (memorize, ~90 seconds)

> "This project provisions a production-shaped but cost-optimized EKS environment in Terraform.
> The root module composes four local modules. The **VPC module** wraps the community VPC module —
> a `/16` across two AZs; for the demo I only created public subnets and skipped the NAT gateway to
> save ~$65/month, and I tagged subnets for ELB discovery. The **EKS module** wraps the community
> EKS module v20: Kubernetes 1.31, a managed node group running AL2023 on Spot `t3a.medium` for cost,
> with CloudWatch agent permissions baked into the node role for observability. Cluster access is
> managed through **access entries** — the modern API-based auth instead of the `aws-auth` ConfigMap.
> The **IAM module** sets up keyless CI/CD: GitHub Actions authenticates via **OIDC** and assumes an
> IAM role with `AssumeRoleWithWebIdentity` — no long-lived AWS keys in GitHub secrets. The trust
> policy is scoped to a specific org, repo, and branch. That role can push images to **ECR** (which
> scans on push and expires old images), describe the cluster, and manage Terraform state in
> **S3 with DynamoDB locking**. I also install the **metrics-server** managed add-on because it's a
> prerequisite for HPA. Trade-offs I made deliberately for a demo: public-only subnets, public API
> endpoint, a single Spot node, mutable ECR tags, and AdministratorAccess on the CI role — and I can
> walk you through exactly how I'd harden each of those for production."

Why this works: it signals you *chose* trade-offs consciously, and it invites follow-ups on topics
you've prepared (OIDC, spot, hardening, observability).

---

## 2. Design decisions — "Why did you do X?" defense table

| Decision | Why (your answer) | Production change |
|---|---|---|
| Community modules (vpc 5.13, eks 20.24) instead of raw resources | Battle-tested, handle hundreds of edge cases (SG rules, tagging, ENI config), faster to deliver, pinned versions | Same, plus renovate/dependabot for version bumps |
| Local child modules wrapping community modules | Stable interface for the root, enforces conventions (tags, naming), lets me change internals without touching root | Same pattern |
| Public subnets only, no NAT | Demo: zero NAT cost (~$32.5/mo per AZ + data), nodes get public IPs directly | Private subnets for nodes + NAT (or NAT instances/IPv6), public subnets only for LBs |
| SPOT `t3a.medium`, min=desired=1, max=2 | ~70% cheaper; demo tolerates interruption | Mixed on-demand base + spot overflow, capacity rebalancing, multiple instance types, PodDisruptionBudgets |
| Public cluster endpoint | Simplest for CI + laptop access; no VPN/Direct Connect exists in a demo | Private endpoint + VPN/bastion, or public with CIDR allowlist |
| Access entries (API auth) | Modern replacement for `aws-auth` ConfigMap; auditable, no in-cluster state to corrupt | Same, enforce `API`-only auth mode |
| GitHub OIDC instead of IAM user keys | No static secrets to leak/rotate; short-lived tokens; trust scoped to org/repo/branch | Same, add `environment` claim scoping per env |
| AdministratorAccess on CI role | Demo pragmatism — Terraform manages many resource types; explicitly commented as a demo shortcut | Least-privilege per service; or split plan role (read-only) vs apply role |
| ECR MUTABLE tags + force_delete | Demo convenience for re-pushing `latest`; easy teardown | IMMUTABLE tags, digest-based deploys, no force_delete |
| Metrics-server as EKS add-on (not Helm) | Managed lifecycle, no Helm release to maintain | Same |
| S3 + DynamoDB state | Standard, encrypted, locked, versioned | S3 native lockfile (`use_lockfile`) on TF ≥ 1.10, or Terraform Cloud |
| `backend "s3" {}` empty + `backend.tfvars` | Keeps secrets/env specifics out of VCS; same code works for any env via different tfvars | Same, or move to env directories |
| 2 AZs | Demo | ≥ 3 AZs for etcd quorum resilience semantics at app level |

---

## 3. Deliberate weaknesses — expect these to be attacked

Interviewers for senior roles hunt for flaws. Each has a prepared answer:

1. **Nodes in public subnets with public IPs** — attack surface; nodes shouldn't be reachable from the internet.
   Fix: private subnets + NAT; the module change is 5 lines (shown in §9, task 1).
2. **Public API endpoint, no CIDR restriction** — anyone can reach the API server (auth still required).
   Fix: `cluster_endpoint_public_access_cidrs` or private-only endpoint.
3. **AdministratorAccess on the CI role** — blast radius if the GitHub repo/token is compromised.
   Fix: least-privilege, split duties; note the trust policy already limits who can assume it.
4. **Single Spot node, min=1** — an interruption or AZ issue = downtime; no PDBs.
   Fix: min 2 across AZs, on-demand baseline, capacity rebalancing, NTH/PDBs.
5. **No control-plane log types enabled** — no audit/API logs by default.
   Fix: `enabled_cluster_log_types = ["api","audit","authenticator","controllerManager","scheduler"]`.
6. **ECR MUTABLE + force_delete** — tag hijack risk; accidental deletion of referenced images.
7. **`Resource: "*"` on ECR/EKS CI policies** — broader than needed; scope to repo/cluster ARNs.
8. **`kubernetes` provider configured from cluster outputs** — provider-depends-on-resource: can't plan k8s resources before the cluster exists; two-pass applies.
9. **Unused `tls` provider + unused `cluster_name` variable in the IAM module** — honest answer: leftover/forward-compatibility; and if `cluster_name` *were* used by an IAM resource, it would create a **module dependency cycle** (EKS needs IAM's role ARN; IAM would need EKS's cluster name output). Fix: pass the static `var.cluster_name` instead of the module output.
10. **DynamoDB locking is the legacy mechanism** — TF ≥ 1.10 supports S3 native lockfiles.
11. **Pinned `addon_version`** for metrics-server — will eventually drift from what AWS supports; needs periodic bumps.
12. **No network policy / no SG restriction beyond module defaults; no Pod Security Standards, no OPA/Kyverno, no secrets encryption (KMS envelope) for etcd.**

---

---

# LEVEL 1 — EASY (warm-up questions)

## Terraform basics

**Q1. What does `terraform init` do here?**
Downloads the pinned providers (aws, kubernetes, tls) and modules (community vpc/eks modules) into `.terraform/`, and configures the S3 backend using `backend.tfvars` (`terraform init -backend-config=backend.tfvars`). It also writes/verifies `.terraform.lock.hcl` with provider checksums.

**Q2. What is `.terraform.lock.hcl` and why commit it?**
The dependency lock file: records exact provider versions + cryptographic hashes. Committing it guarantees every machine/CI runs identical provider binaries (`terraform init` verifies checksums). Update deliberately with `terraform init -upgrade`.

**Q3. What is Terraform state? What would happen if you lost it?**
State (`terraform.tfstate` in S3) maps Terraform resources to real AWS resource IDs and caches attributes. Losing it means Terraform no longer knows it manages the cluster: `plan` wants to recreate everything; destroys become impossible without re-importing (`terraform import`) every resource. Mitigations here: S3 versioning, encryption, DynamoDB locking, and restricted IAM access to the bucket.

**Q4. Why DynamoDB with an S3 backend?**
State locking: before an apply, Terraform writes a lock item (partition key `LockID` = `<bucket>/<key>-md5`) into the table. A second concurrent `apply` fails fast instead of corrupting state with interleaved writes. (Newer alternative: S3 native lockfile via `use_lockfile = true`, TF ≥ 1.10.)

**Q5. Difference between `terraform plan`, `apply`, `refresh`, `destroy`.**
- `plan`: refresh state, diff desired (config) vs actual (state/reality), print actions. Read-only (API reads only).
- `apply`: executes the plan in dependency-graph order, then writes new state.
- `refresh` (`terraform refresh` / `-refresh-only`): updates state to match reality without changing infra — detects drift.
- `destroy`: plans deletion of everything in state.

**Q6. What are modules and why did you use them here?**
Reusable, encapsulated units with inputs (`variables.tf`) and outputs (`outputs.tf`). Here: local modules `./modules/{vpc,eks,iam,ecr}` wrap community modules, giving the root a clean, convention-enforcing interface (naming, tags) and hiding community-module complexity.

**Q7. `module.vpc.vpc_id` in `main.tf` — what is that syntax doing?**
Referencing an output of a child module. It also creates an **implicit dependency edge**: the EKS module's resources won't be planned/created until the VPC outputs are known.

**Q8. What are `default_tags` on the AWS provider?**
Tags automatically applied to every taggable resource the provider manages (here: `Project`, `Environment`, `ManagedBy`). Avoids repeating tag blocks; resources can override keys. Great for cost allocation and "what created this?" questions.

**Q9. What is a data source vs a resource? Give the example from this repo.**
A **resource** creates/manages infrastructure (`aws_iam_role.github_actions`). A **data source** reads existing infrastructure (`data.aws_iam_openid_connect_provider.github` — looks up the GitHub OIDC provider when we don't create it).

**Q10. What does `count = var.create_github_oidc_provider ? 1 : 0` do?**
Conditional creation. An OIDC provider for `token.actions.githubusercontent.com` can exist **only once per AWS account**, so the module either creates it (count=1) or looks it up (count=0 on the data source). Resources with `count` become lists — accessed via `aws_iam_openid_connect_provider.github[0].arn`.

**Q11. What is `cidrsubnet("10.0.0.0/16", 8, i)` computing?**
It carves the `/16` into `/24` subnets (adds 8 prefix bits) and picks the `i`-th one: `10.0.0.0/24`, `10.0.1.0/24`. Each `/24` = 256 addresses, 251 usable in AWS (5 reserved: network, VPC router, DNS, future use, broadcast).

**Q12. What does `merge()` do in the EKS `access_entries` block?**
Combines the static map (GitHub Actions entry) with the dynamically generated map of additional admins (`for` expression keyed `admin_0`, `admin_1`...), producing one map of access entries for the module.

**Q13. `variable "github_org" { type = string }` has no default — what happens?**
Terraform requires a value at plan time (prompt interactively, or error in CI). Values come from `-var`, `-var-file`, `TF_VAR_github_org` env var, or `*.auto.tfvars`.

**Q14. How do you pass secrets to Terraform safely?**
Never hardcode. Prefer: env vars (`TF_VAR_`), CI secret stores, or better — don't pass secrets at all: use OIDC role assumption (as this project does) and have Terraform read secrets from AWS Secrets Manager via data sources. Never commit `*.tfvars` containing secrets; state files contain plaintext — hence encrypted, access-restricted S3 backend.

**Q15. What does `terraform fmt` / `validate` do?**
`fmt`: canonical HCL formatting. `validate`: checks syntax and internal consistency (types, references) **without** touching the cloud or state. Both belong in CI before `plan`.

## AWS / VPC basics

**Q16. What's the difference between a public and private subnet?**
Purely routing: a public subnet's route table has a default route (`0.0.0.0/0`) to an **Internet Gateway**. Private subnets route internet-bound traffic via a NAT gateway (outbound only) or have no internet route at all. Here both subnets are public and `map_public_ip_on_launch` gives every node/pod-host a public IP.

**Q17. What is a NAT gateway and why did you skip it?**
A managed, AZ-scoped service allowing private-subnet instances outbound internet access (responses allowed back in; no inbound initiation). Skipped because nodes are in public subnets and each costs ~$32.5/month/AZ plus data processing — meaningful for a demo.

**Q18. What does `enable_dns_hostnames` / `enable_dns_support` do? Why does EKS care?**
Instances get public DNS names and VPC DNS resolution works. EKS nodes must resolve the cluster endpoint and join using names; required for public endpoints and many AWS service endpoints.

**Q19. What is `map_public_ip_on_launch = true`?**
EC2 instances launched into these subnets automatically receive a public IPv4 address (ephemeral). That's how the worker nodes reach the internet without NAT — and also why they're internet-reachable (SSH locked by security groups, but still exposed).

**Q20. What's an Internet Gateway? Route table? Security group vs NACL?**
- IGW: horizontally scaled VPC component enabling bidirectional internet traffic for public IPs.
- Route table: per-subnet L3 routing decisions (local route always present; `0.0.0.0/0 → igw` makes it public).
- Security group: stateful instance/ENI-level firewall (allow rules only; return traffic auto-allowed).
- NACL: stateless subnet-level firewall (allow+deny, ordered rules, must allow ephemeral ports both ways). Default NACL allows all; SGs are the primary control here.

**Q21. What is the `kubernetes.io/role/elb = 1` subnet tag for?**
Service-of-type-LoadBalancer / LB controller subnet **discovery**: AWS load balancer components use these tags to choose subnets for public ELBs. (Internal LBs use `kubernetes.io/role/internal-elb`.) The cluster-specific tag `kubernetes.io/cluster/<name>` is also used by the community module.

**Q22. What's an ENI?**
Elastic Network Interface — a virtual NIC attached to instances/pods with subnet-scoped private IPs (+ optional public). EKS's VPC CNI attaches multiple ENIs per node and assigns pod IPs from ENI secondary IPs — that's why pods get real VPC IPs.

## EKS / Kubernetes basics

**Q23. What is Amazon EKS? What does AWS manage vs you?**
Managed Kubernetes control plane: AWS runs API servers + etcd across ≥2 AZs, handles control-plane patching/scaling. You manage worker nodes (even with managed node groups, you pick AMI/type/scaling), networking choices, add-ons, workloads, RBAC, upgrades timing.

**Q24. Managed node group vs self-managed vs Fargate vs Karpenter?**
- **Managed node group** (used here): AWS handles node lifecycle (create/terminate/upgrade via the ASG-backed group), you still choose AMI type and instances.
- **Self-managed**: full control, full toil (bootstrap script, AMI, ASG yourself).
- **Fargate**: serverless pods, no nodes; pricier, no DaemonSets, no privileged pods.
- **Karpenter**: not a node group — a just-in-time autoscaler that launches right-sized instances per pending pod; great for heterogeneous/burst workloads.

**Q25. What is AL2023 (the AMI)? What's new vs AL2?**
Amazon Linux 2023 x86_64 standard EKS-optimized AMI. Differences vs AL2: `nodeadm` YAML-based bootstrap (replaces `bootstrap.sh`), cgroupv2, newer kernel/systemd, IMDSv2-enforced by default, faster boot, deterministic updates via versioned repos.

**Q26. What does the metrics-server do and why is it installed?**
A cluster-wide aggregator of resource usage: kubelets expose CPU/memory via the Summary API; metrics-server scrapes them and serves `metrics.k8s.io`. It's required for `kubectl top` and for **HPA** (CPU/memory-based autoscaling) — hence the code comment "required for HPA". It is *not* a monitoring system: no history, no alerting, ~1 min granularity.

**Q27. Pod, Deployment, Service, Ingress — one line each.**
- Pod: smallest unit; 1+ containers sharing net/IPC/uts namespaces.
- Deployment: manages ReplicaSets; declarative replica count + rolling updates/rollbacks.
- Service: stable virtual IP/DNS + kube-proxy load balancing over a label-selected pod set.
- Ingress: L7 HTTP(S) routing rules, realized by an ingress controller (e.g., ALB controller).

**Q28. What happens when you run `kubectl get pods`? (auth path)**
`kubectl` reads kubeconfig → executes the `aws eks get-token` credential plugin → gets a presigned-token (`k8s-aws-v1.` STS presigned URL) → sends it to the public API endpoint → EKS **authenticator** validates the token with STS (`GetCallerIdentity`) → maps the IAM identity to Kubernetes groups via **access entries** → RBAC/ClusterAdmin policy authorizes → response returned.

**Q29. What are EKS access entries (vs the old aws-auth ConfigMap)?**
AWS-API-managed mapping of IAM principals → Kubernetes permissions, using access policies like `AmazonEKSClusterAdminPolicy` with scopes (`cluster` or `namespace`). Advantages over `aws-auth`: auditable via CloudTrail, no in-cluster ConfigMap to corrupt (a bad edit could lock everyone out), revocable without touching the cluster. This repo grants the GitHub Actions role cluster-admin via an access entry.

**Q30. What is a managed add-on (e.g., `aws_eks_addon.metrics_server`)?**
AWS-installs-and-manages the component in your cluster: version validated against the cluster version, updated via API/Terraform, config via the add-on API. Alternatives: self-managed Helm/manifests (more control, more toil). Core add-ons: `vpc-cni`, `kube-proxy`, `coredns` (the EKS module installs these by default).

**Q31. What is kubeconfig and how do you generate one for this cluster?**
Client config with cluster endpoint, CA cert, and credentials. `aws eks update-kubeconfig --name eksdemo --region us-east-1` writes it, using the exec plugin (`aws eks get-token`) for short-lived tokens (~15 min). This repo's `kubernetes` provider uses the same mechanism.

**Q32. Namespace? ClusterRole vs Role?**
Namespace: virtual partitioning of cluster resources + RBAC/network-policy scope boundary. Role: namespaced permissions; ClusterRole: cluster-wide (or reusable across namespaces via RoleBinding). Access entries with `AmazonEKSClusterAdminPolicy` ≈ cluster-admin ClusterRole.

**Q33. What is a DaemonSet? Name two that run on every EKS node.**
Ensures one pod per node (or per matching node). On EKS: `aws-node` (VPC CNI) and `kube-proxy`. Observability agents (Fluent Bit, CloudWatch agent, node-exporter, OTel collector) are also typically DaemonSets.

**Q34. What are requests and limits?**
Requests: scheduler placement + guaranteed share (also drives QoS class). Limits: hard cap — CPU throttled at limit, memory limit breach → **OOMKill** (SIGKILL, container restarted, reason `OOMKilled`, exit 137). No requests/limits = BestEffort QoS = first evicted under node pressure.

## ECR / CI basics

**Q35. What is ECR? What does `scan_on_push` do?**
Managed OCI container registry. `scan_on_push` triggers AWS's basic scanner (Clair-based CVE scan of OS packages) on every push; results surface in console/API and can gate deploys. (Enhanced scanning = Inspector, deeper + continuous.)

**Q36. MUTABLE vs IMMUTABLE image tags?**
MUTABLE: a tag (e.g., `latest`) can be overwritten — convenient for demos, risky for prod (ambiguous provenance, rollback confusion, supply-chain risk). IMMUTABLE: push of an existing tag fails; deploy by unique tag or, better, by **digest** (`repo@sha256:...`).

**Q37. What does the lifecycle policy do?**
Expires (deletes) images once the repo holds more than 30 images (`countType = imageCountMoreThan`, `tagStatus = any`). Keeps storage cost bounded in CI-heavy repos. Risk: can delete an image still referenced by a running deployment — mitigate with tag-aware rules in prod.

**Q38. What is `force_delete = true` on the repo?**
Allows `terraform destroy` to delete the ECR repo even when it contains images. Demo convenience; prod would keep the default (fail non-empty) to prevent image loss.

**Q39. How does GitHub Actions authenticate to AWS here, at a high level?**
Keyless OIDC: the workflow requests an OIDC JWT from GitHub (`id-token: write`), `aws-actions/configure-aws-credentials` exchanges it with STS via `AssumeRoleWithWebIdentity` for short-lived credentials of the `eksdemo-github-actions` role. No AWS keys stored in GitHub secrets.

## Observability basics

**Q40. What are the "three pillars" of observability?**
Metrics (aggregated numeric time series), logs (discrete events), traces (request causality across services). Modern view: pillars are storage formats — the goal is answering arbitrary questions about system behavior; correlation (exemplars, trace IDs in logs) matters as much as the data itself.

**Q41. What are the four golden signals?**
Latency, Traffic, Errors, Saturation (Google SRE). For a Kubernetes API: request latency p99, req/s, 5xx ratio, and saturation of CPU/memory/connection limits. (Node-level: USE method — Utilization, Saturation, Errors per resource. App-level: RED — Rate, Errors, Duration.)

**Q42. SLI vs SLO vs SLA vs error budget?**
- SLI: measured indicator, e.g. `success_rate = 2xx+3xx / total` over a window.
- SLO: internal target on an SLI, e.g. 99.9% over 30 days.
- SLA: external contract with consequences (credits/penalties) — set looser than the SLO.
- Error budget: 1 − SLO (0.1% ≈ 43 min/month of allowed failure); policy lever balancing velocity vs reliability — burn budget fast → freeze risky releases.

**Q43. Metrics vs logs — when do you use which?**
Metrics: cheap, pre-aggregated, ideal for dashboards/alerting on known failure modes (symptoms). Logs: high-cardinality context for unknown-unknowns and root cause. Rule of thumb: alert on metrics, debug with logs and traces.

**Q44. What is CloudWatch? Container Insights?**
CloudWatch: AWS metrics/logs/alarms service. Container Insights: collects EKS cluster/node/pod metrics + logs via the CloudWatch agent (DaemonSet) — which is exactly why the node role here has `CloudWatchAgentServerPolicy`. Alternative many shops prefer: Prometheus + Grafana (open, portable, PromQL).

**Q45. What's an alert fatigue / a good alert?**
Good alerts are **symptom-based** (user impact: error rate, latency), actionable, and have runbooks. Alerting on causes (CPU high) creates noise → fatigue → ignored pages. Multi-window, multi-burn-rate alerting (fast page on 2% budget/hour, slow ticket on long windows) is the SRE-book standard.

---

---

# LEVEL 2 — MEDIUM (applied / "how does this actually work")

## Terraform applied

**Q46. `terraform plan` shows "module.eks... will be created" but the IAM module shows nothing — then apply fails with a cycle error. Explain module dependencies in this repo.**
Dependency edges here: `vpc → eks` (subnet IDs), `iam → eks` (role ARN into access entries), and `eks → iam` exists only as an *unused* input (`cluster_name`) so no edge forms. If someone edited the IAM module to actually use `var.cluster_name` (e.g., in a policy), Terraform would report `Cycle: module.eks..., module.iam...` because each module would depend on the other's resources. Fixes: pass the statically-known `var.cluster_name` instead of `module.eks.cluster_name`, or move access entries out of the EKS module into a third component that depends on both.

**Q47. What is the execution graph / how does Terraform decide order?**
Terraform builds a DAG from references (`module.eks.cluster_name`, explicit `depends_on`, provider configs). Nodes with no unmet dependencies run in parallel (`-parallelism=10` default). Everything in `main.tf` resolves: vpc and ecr and (partially) iam can start together; eks waits for vpc + the IAM role; metrics-server waits for eks (`depends_on` is redundant there — the `cluster_name` reference already creates the edge — but makes intent explicit).

**Q48. `depends_on` — when is it appropriate? What are its downsides?**
For hidden/runtime dependencies Terraform can't infer (e.g., a policy attachment that must exist before a service can use a role — classic "iam role eventually consistent" issue). Downsides: forces full ordering (the dependent waits for the *entire* target), and it makes values unknown until apply, which can cascade "known after apply" through plans. Prefer implicit references when possible.

**Q49. The `kubernetes` provider is configured from `module.eks` outputs. What's the catch?**
"Provider configuration depends on resources": on a fresh state, endpoint/CA are unknown at plan time, so Terraform cannot fully plan Kubernetes resources until the cluster exists (deferred/`-target` two-pass workflows). Best practice for larger setups: separate root modules/stacks — one for the cluster, one for in-cluster resources — so each has a clean plan.

**Q50. How does the `exec` block in the kubernetes provider authenticate?**
It shells out to `aws eks get-token --cluster-name ...`, which returns an `ExecCredential` (a token valid ~15 min, `apiVersion client.authentication.k8s.io/v1beta1` here). The provider re-invokes it on expiry. Note: K8s 1.30+ clients prefer `v1` — pinning `v1beta1` works with current aws-cli but is a maintenance item.

**Q51. How would you structure this repo for dev/stage/prod? Compare workspaces vs directories.**
- **Workspaces**: same code + state key per workspace (`terraform workspace select`). DRY, but envs differ only by variables — dangerous when infra should diverge; all workspaces share one backend config.
- **Directory-per-env** (`envs/dev/main.tf` → shared modules): explicit divergence, separate backends/permissions per env, safer blast radius — some duplication.
Senior answer: directories (or Terragrunt) for prod separation; workspaces acceptable for ephemeral/PR environments. Also split state by component (network/cluster/add-ons) to limit `apply` blast radius.

**Q52. What are `precondition`/`postcondition` and `validation` blocks? Show one you'd add here.**
`validation` on variables fails fast at plan time:
```hcl
variable "node_capacity_type" {
  type = string
  validation {
    condition     = contains(["SPOT", "ON_DEMAND"], var.node_capacity_type)
    error_message = "Must be SPOT or ON_DEMAND."
  }
}
```
`precondition`/`postcondition` live in resource/data lifecycles — e.g., precondition that `node_min_size >= 1`.

**Q53. State file contains the cluster CA and other sensitive values. How is it protected?**
`encrypt = true` (SSE-S3; SSE-KMS for stricter control), bucket versioning + MFA delete recommended, bucket policy denying non-TLS, IAM policy (the one in `modules/iam`) scoped to `GetObject/PutObject/DeleteObject` on the key prefix only, DynamoDB for lock integrity. Principle: treat state as a secret store — least privilege access, no public access, audit via CloudTrail/S3 access logs.

**Q54. Someone manually resized the node group in the console to 3. What happens on next plan/apply? How do you detect this earlier?**
Refresh detects drift; plan proposes changing desired size back to 1 — and apply would scale it down, possibly evicting workloads. Options: accept reality (`terraform plan -refresh-only`, update code), or `ignore_changes = [desired_size]` on the node group (common pattern once cluster-autoscaler/Karpenter owns sizing — in fact you *should* ignore desired_size with autoscalers). Earlier detection: scheduled `terraform plan -detailed-exitcode` in CI, or drift tools (driftctl).

**Q55. `terraform apply` fails midway creating the cluster (API timeout). What state are you in and how do you recover?**
Partial state: resources already created are recorded; the failed one may be tainted/orphaned. Re-run `plan`/`apply` — Terraform resumes from state. If a resource exists in AWS but not in state (orphan), `terraform import` it; if state says it exists but AWS deleted it, `terraform state rm`. EKS cluster creation takes ~10 min — timeouts are common; the AWS provider retries, and a second apply typically converges.

**Q56. Why is `authentication_mode` relevant in module v20? What changed from v19?**
v20 made **access entries** the primary auth path (`authentication_mode` default `API_AND_CONFIG_MAP`), replacing `manage_aws_auth_configmap`. Migration considerations: existing aws-auth entries must be ported to access entries; once on `API`-only, the ConfigMap is ignored. Cluster creator admin permissions are also handled via an access entry flag in v20 (`enable_cluster_creator_admin_permissions`).

**Q57. How do you safely upgrade this stack: TF 1.9 → newer, provider 5.x → 6.x, module 20 → 21, EKS 1.31 → 1.32?**
Order: bump one axis at a time; read changelogs (module v21 had breaking changes around authentication defaults); pin and `-upgrade` the lock file; `plan` in CI; state is forward-migratable only — back up state (`terraform state pull`) first. For EKS itself: control plane upgrade first, then add-ons, then node groups; check deprecated APIs (`kubectl deprecations`, pluto/kubent) before upgrading 1.31→1.32; never skip minor versions.

**Q58. `terraform plan` in CI on every PR — what permissions does the CI role actually need vs apply?**
Plan needs read-only (state read + AWS Describe/List + refresh permissions). Principle: two roles — `plan` role (ReadOnlyAccess-ish, no state write beyond lock) for PRs, `apply` role (what this repo approximates with one role + Admin) gated behind protected environments/manual approval in GitHub Environments. This repo collapses both into one — acceptable demo, called out as a prod improvement.

**Q59. What does `jsonencode` do and why use it for IAM policies?**
Builds JSON from HCL values — gets quoting/escaping right, keeps policies diff-friendly and lets you interpolate (`${var.github_org}`) naturally, unlike heredoc JSON strings. Alternative: `aws_iam_policy_document` data source (adds validation, `statement` blocks, cleaner for large policies).

**Q60. Explain `ForAnyValue:StringLike` in the OIDC trust policy. Why two `sub` patterns?**
`ForAnyValue:` is a set operator: the condition passes if **any** value of the multi-valued `sub` claim matches one of the patterns. Two patterns because GitHub introduced an **immutable repo-identity format** (`repo:ORG@*/REPO@*:ref:...`) for repos created after mid-2026 while legacy repos keep `repo:ORG/REPO:ref:...` — allowing both makes the role work for either repo vintage. The `StringEquals` on `aud` pins the token audience to `sts.amazonaws.com`, preventing tokens minted for other audiences from being replayed.

**Q61. What happens if two people `terraform apply` simultaneously? Walk through the lock.**
A acquires the DynamoDB lock item, applies (~10+ min for EKS), writes state, deletes the lock. B's `apply` fails immediately with a lock error containing who/when/ID. If A's process dies, the lock remains: `terraform force-unlock <ID>` after confirming A is truly dead. Lock prevents state corruption, not cloud conflicts — hence also CI serialization (single apply pipeline, `concurrency` groups in GitHub Actions).

## EKS / Kubernetes applied

**Q62. Why can pods on these nodes reach the internet, and what's the IP path?**
Nodes are in public subnets with public IPs; VPC CNI gives each pod a private VPC IP from an ENI; egress goes: pod → node eth0 → (for internet dest) SNAT via the node's primary IP (`AWS_VPC_K8S_CNI_EXTERNALSNAT` behavior: CNI SNATs to the node IP for external destinations) → IGW → internet. Return traffic follows conntrack back. In private subnets, the same flow ends at the NAT gateway.

**Q63. How many pods can run on a `t3a.medium` here, and why?**
Default EKS max-pods for t3a.medium = **17**: the instance supports 3 ENIs × 6 IPv4 addresses each; formula `ENIs × (IPsPerENI − 1) + 2` (one IP per ENI is the primary, +2 for CNI/host pods). Raising it: `ENABLE_PREFIX_DELEGATION=true` (+ WARM_PREFIX_TARGET) assigns /28 prefixes — supports up to 110 pods on most types (needs CNI ≥ 1.9 and enough subnet space — /24 subnets are tight).

**Q64. Your nodes are in public subnets — how would you move them private without downtime?**
Create private subnets + NAT in the VPC module (see §9 task 1), then create a *new* managed node group in private subnets, `kubectl cordon` old nodes, `kubectl drain` one at a time (respect PDBs), verify workloads healthy, then delete the old node group. Managed node groups make this a rolling, zero-downtime migration. Control-plane ENIs stay as-is (they're cross-account, placed in the subnets passed at cluster creation — changing *those* requires care; `subnet_ids` change on the cluster is a control-plane update, not a recreate).

**Q65. Spot node gets a 2-minute interruption notice. Walk through exactly what happens, and how you'd make it graceful.**
EC2 posts a rebalance recommendation first, then the Spot interruption notice (EventBridge + instance metadata + node condition). EKS managed node groups cordon the node; with the **AWS Node Termination Handler** (or native MNG handling), the node is drained: pods get eviction API calls honoring **PodDisruptionBudgets**, `terminationGracePeriodSeconds` lets apps finish in-flight requests, then SIGTERM → SIGKILL. To be resilient: ≥2 nodes across AZs, multiple replicas with anti-affinity, PDBs (`minAvailable`), capacity rebalancing (MNG proactively launches a replacement on rebalance recommendation), and diversified instance types. For truly interruption-intolerant workloads: on-demand node group with taints/selector.

**Q66. Cluster autoscaler vs Karpenter vs HPA vs VPA — how do they interact here?**
- **HPA**: scales pod replicas on metrics (needs metrics-server — installed).
- **VPA**: right-sizes pod requests/limits (restarts pods to apply).
- **Cluster Autoscaler**: adds/removes *nodes* when pods are unschedulable / nodes underutilized; works per-ASG; needs IAM (IRSA) + discovery tags.
- **Karpenter**: provisions nodes directly (no ASG), right-sizes instance types, faster, consolidates.
Interaction pitfall: HPA scales pods → pending pods trigger node scale-out. Keep VPA and HPA from fighting over the same metric; don't run both autoscalers on one node group. With max_size=2 here, scaling headroom is minimal — fine for demo.

**Q67. A pod is `Pending`. Debug it.**
`kubectl describe pod` → events. Common causes here: insufficient CPU (unschedulable → need autoscaler/Karpenter), max-pods/ENI IP exhaustion on t3a.medium (17 pods — check `aws-node` logs / `kubectl get node -o yaml | grep pods`), taints without tolerations, PVC not bound (no EBS CSI driver installed by default → pending PVC), image pull issues appear as ImagePullBackOff instead. If scheduler events say `0/1 nodes available`, scale the node group.

**Q68. A Service type=LoadBalancer is stuck with `<pending>` EXTERNAL-IP. Why might that fail here?**
Needs an AWS LB controller (not installed by default on bare EKS — in-tree controller provides *classic* ELB for type=LoadBalancer, actually in-tree works for CLB/NLB without extra install). Real causes to check: subnet tags (`kubernetes.io/role/elb=1` present — good), IAM permissions on the node role for EC2/ELB (the EKS module attaches what's needed for in-tree), no available EIP/quotas, security group rules. Check `kubectl describe svc` events. Modern answer: install **AWS Load Balancer Controller** for NLB/ALB + IRSA.

**Q69. `kubectl logs` returns nothing / "Error from server: Get https://<node-ip>:10250..." — what's the mechanism?**
API server proxies log/exec requests to the **kubelet** (port 10250) over the node network. Failures: control-plane SG → node SG rule missing (module handles this via `cluster_security_group_id` ↔ node SG rules), node down, kubelet cert/auth issues. Demonstrates the control-plane↔node trust: EKS puts its ENIs in your subnets; the cluster SG mediates.

**Q70. How does DNS work inside this cluster?**
CoreDNS (managed add-on) runs as a Deployment (default 2 replicas), exposed by the `kube-dns` ClusterIP (from the EKS service CIDR, typically `172.20.0.10`). Kubelet injects it as pod `nameserver`; search domains enable `svc` / `svc.ns.svc.cluster.local` resolution. CoreDNS forwards non-cluster names to the VPC resolver (.2 address). Debug: `kubectl run -it dnstools -- dig`, check CoreDNS logs/metrics (`coredns_dns_requests_total`), watch for throttling of UDP/53 (PPS per ENI) and conntrack exhaustion on busy nodes (common cause of intermittent 5s DNS delays → nodelocal DNS cache fix).

**Q71. Explain EKS pod identity options: IRSA vs EKS Pod Identity.**
- **IRSA** (IAM Roles for Service Accounts): cluster's OIDC issuer + per-account IAM role trust on `sub = system:serviceaccount:ns:name`; projected token in the pod; AWS SDKs exchange via `AssumeRoleWithWebIdentity`. The classic, works everywhere.
- **EKS Pod Identity** (2023+): an agent DaemonSet + `aws_eks_pod_identity_association`; simpler (no OIDC provider/trust edits per account), session tags, but requires the add-on and newer SDKs.
Either beats putting AWS keys in pods or over-privileging the node role. The node role here only needs the EKS-worker basics + the CloudWatch policy.

**Q72. How would you give an app in the cluster read access to one S3 bucket? (end to end)**
1) IAM role with trust on the cluster OIDC issuer, condition `aud=sts.amazonaws.com`, `sub=system:serviceaccount:app:app-sa`; permission policy `s3:GetObject` on `arn:aws:s3:::bucket/*`. 2) ServiceAccount annotated `eks.amazonaws.com/role-arn`. 3) Deployment uses that SA. Verify: `aws sts get-caller-identity` inside the pod. In Terraform: cluster OIDC issuer comes from the EKS module output (`oidc_provider_arn`) — a natural extension of `modules/iam`.

**Q73. What are EKS control plane logs, which types exist, and why enable them?**
`api`, `audit`, `authenticator`, `controllerManager`, `scheduler` → CloudWatch Logs (charged per GB). Uses: audit forensics (who deleted what — answer to "who killed the deployment?"), authenticator logs for access debugging, API logs for latency/errors analysis, scheduler for placement issues. Off by default (cost); enable via `enabled_cluster_log_types`. A senior answer includes shipping audit logs to long-term storage (S3 via subscription filter) and alerting on specific audit events (e.g., RBAC escalation attempts).

**Q74. How does the EKS control plane talk to nodes and vice versa? What's in your account vs AWS's?**
Control plane runs in an AWS-owned account; EKS places **cross-account ENIs** in *your* subnets (that's why you pass `subnet_ids` at cluster creation and why the cluster SG exists). Nodes register to the API endpoint (public here; private endpoint adds a Route53 private hosted zone). Kubelet ↔ API over 443; API → kubelet 10250 for logs/exec; webhooks/admission controllers also traverse this path (common cause of "webhook timeout" = SG blocks control plane → node 443).

**Q75. Rolling update of the node group AMI (e.g., new AL2023 release): what happens under the hood?**
Managed node group update: creates new LT version → ASG instance refresh: launches replacement nodes, waits healthy, cordons+drains old nodes (honors PDBs), terminates. `desired`/`min` respected throughout. Watch: pods without PDBs can stall drains; AL2023 `nodeadm` config changes between module versions; always test in a lower env. `update_config` (e.g., `max_unavailable_percentage`) tunes speed vs safety.

**Q76. What is etcd in EKS, and what are its operational limits you should know?**
The control-plane datastore (all cluster state). AWS manages it (backups, quorum across AZs). What *you* must know: object size limits (~1.5MB/object), total DB size guidance (~8GB), watch/quota errors (`etcdserver: request too large`, `mvcc: database space exceeded`) appear as API errors; explosion of ConfigMaps/CRDs/events can degrade the whole cluster. You can't snapshot EKS etcd yourself → app-level backups (Velero) are the DR answer.

**Q77. How would you run a stateful app (e.g., a database) on this cluster? What's missing?**
Missing: an EBS **CSI driver** (EKS 1.31 no longer ships in-tree EBS provisioning; install `aws-ebs-csi-driver` add-on + IRSA role), StorageClass (`gp3`), then StatefulSet + volumeClaimTemplates, Pod anti-affinity across AZs (note: EBS is AZ-bound → multi-AZ failover needs EFS/regional solutions or app-level replication like Postgres streaming), backup story (snapshots/Velero). Also bump node types — t3a.medium Spot is unsuitable for stateful.

**Q78. What security layers exist in this cluster today and what's missing for production?**
Present: IAM-authenticated API access, access entries, SGs, private pod IPs (though nodes are public), ECR scan-on-push, encrypted state, OIDC CI. Missing: private endpoint, network policies (Calico/Cilium — VPC CNI added native network policy support), Pod Security Standards/Restricted namespaces, secrets encryption in etcd via KMS (`encryption_config`), image verification (Kyverno/OPA or ECR + admission control), runtime security (Falco/GuardDuty EKS Runtime Monitoring), GuardDuty EKS Protection/Audit Log Monitoring, vulnerability pipeline (Trivy in CI), IRSA everywhere, CIS EKS benchmark scan (kube-bench).

**Q79. Explain the difference between `kubectl drain` and `cordon`, and how PDBs interact.**
Cordon: marks node unschedulable (no new pods). Drain: cordon + evicts pods via the Eviction API, which **respects PodDisruptionBudgets** — if eviction would violate `minAvailable`/`maxUnavailable`, it waits. PDB misconfiguration (e.g., `maxUnavailable: 0` on a 1-replica deployment) deadlocks drains — a classic outage during upgrades. Managed node group upgrades and spot handling both go through this path.

**Q80. What are taints/tolerations and node affinity — when do you use which here?**
Taints repel pods from nodes unless tolerated (e.g., taint a new on-demand node group `workload=critical:NoSchedule`, add tolerations to critical apps). Node affinity attracts pods to nodes (labels like `node.kubernetes.io/instance-type`). Combined pattern for mixed spot/on-demand: on-demand group tainted + critical pods get toleration + nodeSelector; everything else lands on spot. Pod anti-affinity spreads replicas across AZs/nodes.

---

---

# LEVEL 3 — HARD (deep internals, design, "why does this break")

## Deep EKS / Kubernetes internals

**Q81. Trace a packet: pod in this cluster calls an external HTTPS API. Every hop, every IP rewrite.**
Pod (VPC IP, e.g. 10.0.0.37) → default route via pod's veth to host → iptables/nftables conntrack → routing decision: destination not in VPC CIDR → VPC CNI SNAT rule rewrites source to node primary IP (10.0.0.10 / public EIP mapped) → IGW performs 1:1 NAT to the node's public IP → internet → TLS terminated at destination. Return path reverses via conntrack. Inside-VPC destinations are *not* SNATed (pods are first-class VPC citizens — `EXTERNALSNAT` only for external). Service ClusterIP destinations get DNATed by kube-proxy (iptables mode) to a pod IP *before* this egress logic.

**Q82. Same question but pod calls another Service in the cluster. Where does load balancing happen?**
DNS resolves `svc.ns` → ClusterIP (172.20.0.x). kube-proxy (iptables mode, default on EKS) has programmed rules: packets to ClusterIP:port are DNATed (statistically, per-endpoint probability) to one pod IP — connection, not per-packet. No overlay: the destination pod IP is routable directly across nodes because VPC CNI allocates real VPC IPs (this is EKS's big networking differentiator vs calico/flannel overlays). Failures at each stage: CoreDNS (name resolution), kube-proxy rule sync lag (endpoint updates), conntrack table exhaustion (UDP/TCP churn), SG/NACL between nodes.

**Q83. Your /24 public subnets are running out of IPs. What are all the contributing factors and remedies?**
Consumers: node primary IPs, one ENI primary per ENI, pod secondary IPs (17/node), plus AWS's 5 reserved. With ~251 usable per /24, a handful of large nodes can exhaust it. Remedies: bigger subnets/new CIDR association (VPC secondary CIDR + **custom CNI networking** — `AWS_VPC_K8S_CNI_CUSTOM_NETWORK_CFG` putting pods in separate CGN 100.64.0.0/10 subnets), prefix delegation (fewer IPs wasted as warm pool), reduce WARM_IP_TARGET, IPv6 (EKS IPv6 clusters get /80 per pod prefix — effectively unlimited). Operational signal to watch: `aws-node` logs "InsufficientCidrBlocks"/`ipamd` warm-pool metrics.

**Q84. Explain the `token.actions.githubusercontent.com:sub` claim, `aud`, thumbprints — the whole OIDC trust chain. What attacks does each piece prevent?**
GitHub's OIDC provider signs a JWT (RS256) containing claims: `iss` (token.actions.githubusercontent.com), `aud` (audience — requested as `sts.amazonaws.com`), `sub` (repo/ref identity), plus `repository`, `ref`, `sha`, `actor`, `environment`. STS fetches GitHub's JWKS over TLS to verify the signature. The IAM OIDC provider resource pins the issuer URL (and historically TLS **thumbprints** — now largely advisory since AWS validates via the CA chain). Trust policy checks: issuer == the provider; `aud == sts.amazonaws.com` → prevents a JWT minted for another service being replayed at STS; `sub` StringLike repo:org/repo:ref:main → prevents a workflow in *any other repo/org* from assuming the role. Remaining risks the *conditions don't* cover: malicious workflow on main branch, compromised GitHub token within the allowed repo — hence least privilege on the role and protected branches/environments.

**Q85. `AssumeRoleWithWebIdentity` vs `AssumeRole` — mechanics and trust implications.**
`AssumeRole`: principal is an IAM entity; trust evaluates IAM identity; creds from the caller's account context — used for human roles, cross-account. `AssumeRoleWithWebIdentity`: caller presents an OIDC JWT from a federated provider; no IAM identity needed at all — perfect for CI where you don't want to provision users/keys. Session duration here defaults to 1h (configurable on the role, up to 12h for web identity sessions per role max). CloudTrail records `assumed-role/ROLE/session-name` — set a meaningful `role-session-name` (e.g., `GitHubActions-${run_id}`) for auditability.

**Q86. Why does EKS need your subnet IDs at all if the control plane is in AWS's account? Where exactly do those ENIs live?**
EKS creates cross-account ENIs (visible in your EC2 console, "Amazon EKS <cluster>") attached from the AWS-managed control plane into your VPC subnets. They: (1) terminate the private endpoint path and kubelet/webhook connectivity to nodes, (2) are why cluster SG rules govern API↔node traffic, (3) pin the control plane to specific AZs/subnets — choosing subnets across ≥2 AZs gives control-plane HA. Consequence: those subnets must have free IPs and routes to nodes; deleting/recreating them breaks cluster management.

**Q87. Cluster upgrade 1.31 → 1.32: give the full safe procedure for this repo, including what breaks if you just bump `cluster_version`.**
1) Audit workload APIs for removals (kubectl get → check `deprecated` APIs via pluto/kubent against 1.32). 2) Bump `cluster_version` — control plane upgrades (~10–20 min, API briefly unavailable for writes, kubectl keeps working against the other API instances). 3) Upgrade managed add-ons (vpc-cni/kube-proxy/coredns/metrics-server to versions compatible with 1.32 — skew policy: kube-proxy/CNI within one minor of control plane). 4) Update node groups — new AL2023 AMI for 1.32; MNG rolls nodes with drain. If you *only* bump the version: nodes stay on 1.31 kubelet (supported skew kubelet ±1... actually kubelet can be up to 3 minors behind per modern skew policy, but EKS MNG will want matching AMIs), add-on versions drift, and Terraform may show perpetual diffs on `addon_version`. Also: `platform_version` changes appear in plan — don't fight them.

**Q88. How would you achieve zero-downtime deployments for an app on this cluster — every layer?**
App: ≥2 replicas, pod anti-affinity across nodes/AZs, PDB minAvailable=1, readinessProbe that reflects real dependency health (gates endpoint inclusion + rolling update progress), preStop sleep/graceful shutdown to drain in-flight connections (race: endpoint removal propagates async via kube-proxy — SIGTERM arrives before all proxies updated → preStop 5–10s absorbs it), rolling update `maxSurge=1, maxUnavailable=0`. Ingress: connection draining on ALB (deregistration delay). Infra: node drains honor PDBs; cluster upgrades rolling; DNS TTLs sane. Data: schema migrations backward compatible (expand-migrate-contract). Verify: `kubectl rollout status`, automated rollback on failed smoke checks (Argo Rollouts canary/metric analysis).

**Q89. The API server returns `429 Too Many Requests` / clients time out. What are the mechanisms and mitigations?**
APF (API Priority and Fairness) queues requests by priority level; controller/operator storms (informers resyncing, many watches), `kubectl` loops without pagination, or excessive CRDs/webhooks can saturate. Also EKS control-plane scaling is automatic but not instant. Mitigations: client-side rate limits (`--qps/--burst` sane defaults, shared informers), avoid LIST-all-pods loops (use field selectors, watch cache), reduce CRD sprawl, cache discovery (client-go discovery cache), shard controllers, use server-side apply/pagination. Observe: `apiserver_request_total`, `apiserver_flowcontrol_*`, EKS API logs in CloudWatch, request latency SLOs. This is also a symptom of etcd pressure.

**Q90. What's the blast radius if the `eksdemo-github-actions` role is compromised, and how do you shrink it? Design the answer.**
Today: AdministratorAccess + EKS cluster-admin + state write → full account compromise, including *reading the Terraform state* (all outputs) and modifying any infra. Shrink: (1) split roles — `tf-plan` (read-only), `tf-apply` (scoped write, no IAM privilege escalation: deny `iam:*` except needed, `iam:PassRole` only to specific roles), `deploy` (ECR push + `eks:DescribeCluster` + access entry with a **namespace-scoped** `AmazonEKSAdminPolicy`, not cluster-admin); (2) GitHub Environments with required reviewers on the apply job — a human gate per apply; (3) scope `sub` to environment claims (`repo:...:environment:prod`); (4) permission boundary on roles the CI role can create; (5) SCPs as the outer fence (deny regions, deny disabling CloudTrail/GuardDuty); (6) short session duration; (7) alert on `AssumeRoleWithWebIdentity` anomalies via CloudTrail → EventBridge.

**Q91. Design the state layout and account topology for taking this to a real company.**
Multi-account (AWS Organizations): `infra` account for state/DNS/shared, `dev/stage/prod` workload accounts; CI role does cross-account `AssumeRole` chains. State per layer per env: `prod/network`, `prod/cluster`, `prod/addons`, `prod/apps` — small blast radius, independent applies, outputs consumed via `terraform_remote_state` or SSM parameters. Guardrails: SCPs, centralized CloudTrail/Config, GuardDuty org-wide. Modules in a versioned registry (git tags) with semantic versioning; root repos pin versions. Promotion = PR bumping module version across env dirs (not re-applying different code).

**Q92. Terraform: explain why `data.aws_iam_openid_connect_provider.github[0]` + `count` pattern is needed and its pitfalls.**
Only one OIDC provider per URL can exist per account, and it may have been created by another stack/team — so the module supports both create and import-by-read. Pitfalls: (1) flipping the flag from false→true while the provider exists fails (already exists) — must `terraform import aws_iam_openid_connect_provider.github[0] <arn>` first; (2) the data source fails at plan if the provider doesn't exist yet (can't read what isn't there) — the flag must be right on first run; (3) count-indexed refs (`[0]`) make every downstream reference index-aware — a refactor from `count` to `for_each` later is breaking. Modern alternative: `terraform import` block (TF 1.5+) or the `iam_oidc_provider` being its own tiny shared stack whose ARN is an SSM parameter.

**Q93. What is `terraform_remote_state`, and what are the alternatives for cross-stack outputs? When would each bite you?**
Reading another state file as a data source (S3 backend config → outputs). Bites: state consumer breaks when producer renames outputs; consumers need read access to the *entire* state (all secrets in outputs); cross-region/account auth complexity. Alternatives: SSM Parameter Store / Secrets Manager (decoupled, fine-grained IAM, values mutable outside TF), or merge stacks. Senior pattern: publish only contract outputs (VPC ID, subnet IDs, cluster name) to SSM; version them.

**Q94. EKS pricing & capacity: what does this demo cost per month, and what dominates?**
Control plane: $0.10/hr ≈ $73/mo. One t3a.medium spot: ~$0.0125/hr ≈ $9/mo. EBS root volumes, minor. NAT would add $32.5+/AZ if enabled. Data transfer + LB per-hour when apps come. So: the *control plane dominates* — a real fleet cost-optimizes via consolidation (fewer, bigger clusters vs many small — trade against blast radius/noisy neighbor/quotas), spot coverage, Graviton (t4g ≈ 20% cheaper), Karpenter consolidation, and tagging everything (default_tags here) for showback via Cost Explorer/Kubecost.

**Q95. Kubelets report `DiskPressure` / nodes go NotReady intermittently on t3a.medium. Diagnose systematically.**
t3a is burstable: check CPU credit balance (CloudWatch `CPUCreditBalance`) — sustained >baseline CPU → throttling → kubelet heartbeats delayed → NotReady flapping. DiskPressure: container images/logs accumulating (kubelet garbage collects at thresholds; emptyDir + logs count against root EBS — default 20GB? MNG default root volume ~ 20GB unless LT overrides; AL2023 defaults 20GB). Fixes: larger root volume via launch template, tune `--image-gc-*` / eviction thresholds, log rotation (containerd max log size), move emptyDir to memory or EBS. Also memory: no swap by default (AL2023); a leaky pod → node OOM → NotReady. Observe: node-exporter `node_filesystem_*`, kubelet `evictions_total`, CloudWatch agent memory metrics (memory is NOT in default EC2 metrics!).

**Q96. How do you back up and restore this cluster? What can you NOT back up?**
You cannot snapshot EKS etcd. Backup strategy = rebuild + app-data: (1) everything declarative — this repo *is* the cluster backup for infra (Git → terraform apply); (2) workloads in Git (GitOps: ArgoCD/Flux) — cluster is cattle; (3) stateful data: Velero (restic/Kopia for PVs + manifests), EBS snapshots, or app-native (RDS/out-of-cluster datastores preferred for real prod); (4) secrets: External Secrets from AWS Secrets Manager → nothing to back up in-cluster. DR plan: RTO measured by `terraform apply` (~15 min) + app redeploy + data restore; test restores quarterly — an untested backup is a hope.

**Q97. Compare EKS vs running k8s yourself on EC2 vs ECS — for this use case.**
EKS: k8s API ecosystem (operators, Helm, GitOps, portable skills), AWS handles control plane HA; cost $73/cluster + complexity tax. DIY EC2 k8s (kops/kubeadm): full control (etcd access, custom APIServer flags), full toil (etcd backups, CA rotation, upgrades) — justified only for exotic requirements. ECS: simpler, deeply AWS-native, cheaper control plane (free), but weaker ecosystem and portability; fine for small teams without k8s needs. For an org already invested in k8s tooling and wanting portability/complex schedulers/operators → EKS. Answer should be trade-off driven, not religious.

**Q98. What are `finalizers`, and how can they wedge a namespace in `Terminating`? How do you fix it?**
Finalizer = marker on an object blocking deletion until a controller does cleanup (e.g., AWS LB controller deleting the ALB, PV protection). If the controller is gone (you deleted the LB controller first) or failing (IAM denied), the object — and its namespace — hangs in Terminating. Fix: find blockers `kubectl get ns x -o json | jq .spec.finalizers` and per-resource; restore the controller/permission and let it finish; last resort: remove the finalizer via `kubectl patch ... --type=merge -p '{"metadata":{"finalizers":[]}}'` (accepting leaked cloud resources — then clean up manually). Classic ordering bug in Terraform: delete namespace/module before the controller cleaned up.

**Q99. Explain admission controllers/webhooks and how they cause outages; what's the safe pattern?**
Mutating/validating webhooks intercept API requests (e.g., OPA/Kyverno policy, service-mesh sidecar injection, AWS LB controller). Failure modes: webhook pods down or SG blocks control-plane→node:443 → API calls matching the webhook **fail closed/open per `failurePolicy`** — `Fail` + all webhook replicas on one spot node = cluster-wide deploy outage. Safe pattern: `failurePolicy: Ignore` where tolerable, exclude `kube-system`, ≥2 webhook replicas with PDB + anti-affinity, sane timeouts (≤10s), namespaceSelector scoping, monitor `apiserver_admission_webhook_*` latency/rejections.

**Q100. Node group desired=1, min=1, max=2: HPA scales pods, cluster runs out of room. Without cluster-autoscaler installed, what happens? What would you add?**
Pods go Pending (`Insufficient cpu`), HPA keeps adding replicas that never schedule — no node appears because nothing talks to the ASG. Add: **Karpenter** (my choice for greenfield: NodePool CRDs, direct EC2 provisioning, consolidation, spot-aware) or cluster-autoscaler (Deployment + IRSA role + ASG tags `k8s.io/cluster-autoscaler/enabled` and `k8s.io/cluster-autoscaler/<cluster>`; scale-down needs `--ignore-daemonsets-utilization` care and PDB respect). Terraform-wise: autoscaler needs an IRSA role in `modules/iam` + Helm release in an add-ons layer; also `ignore_changes = [desired_size]` on the node group to stop TF fighting the autoscaler.

**Q101. How does `kubectl exec`/`logs` actually traverse security, and why does it matter for compliance?**
Kubelet's 10250 HTTPS endpoint authenticates the API server via client cert (TLS bootstrap), authorizes via webhook to the API server (`nodes/proxy`, `nodes/log` RBAC). Every exec session can be captured by **EKS audit logs** (`exec` events contain the command — with request-level audit policy you get payloads). Compliance angle: restrict `pods/exec` RBAC, prefer debug containers (`kubectl debug`, ephemeral containers), gate interactive access behind SSO+break-glass, and alert on audit events for exec into prod namespaces.

**Q102. You must migrate the cluster to Graviton (arm64). Plan it.**
Add a second managed node group: `ami_type = AL2023_ARM_64_STANDARD`, t4g instances, taint `arch=arm64` initially. Ensure images are multi-arch (`docker buildx --platform linux/amd64,linux/arm64` in CI — ties into the ECR/CI design!). Roll workloads: toleration+affinity per workload, validate, then switch default. Add-ons on EKS are multi-arch already. Watch: any node-local agents/images not multi-arch, JIT/JVM images needing rebuild. Cost win ~20–30% better price/perf; can also just add arm to the *same* MNG? No — one instance_types architecture per group (mixed arch needs separate groups; Karpenter handles multi-arch in one NodePool).

**Q103. What happens to running pods when you change `instance_types` on the managed node group? When does Terraform replace vs update the group?**
MNG changes that alter the launch template (instance types, AMI, disk, user data) trigger a **new LT version + node replacement** (rolling: new nodes join, old cordon/drain/terminate). Some changes (min/max/desired, labels) update in place. Some module-level changes force node group *recreation* (name change) — Terraform shows `create_before_destroy` behavior from the module; review plans for `-/+` on node groups carefully: recreate without the module's safeguards could evict everything at once (the community module sets create_before_destroy true to avoid zero-node windows).

**Q104. Deep: how do EBS volumes behave across the spot drain, and what is `WaitForFirstConsumer`?**
EBS is zonal. A PVC with binding mode `Immediate` provisions in whatever AZ at claim time — pod may then be unschedulable elsewhere. `WaitForFirstConsumer` (default in good StorageClasses): provisioning deferred until a pod is scheduled → volume created in the pod's AZ. On node drain, a stateful pod with an EBS volume reschedules to the *same AZ*; the volume detach/attach takes tens of seconds (force-detach paths can take minutes — stuck `Multi-Attach` errors during node hard-death are classic). This is why databases on EKS need app-level replication, not just EBS.

**Q105. Architect a multi-cluster / multi-region version of this platform.**
Trade-offs first: region = failure domain + data residency; multi-cluster within a region for blast radius/tenancy. Layers: global (Route53 health-check routing/ARC, global ECR replication, IAM), regional per-cluster stacks (this repo × N), and a fleet-management layer (ArgoCD with ApplicationSets per cluster; or EKS Anywhere/Fleet concepts). Shared services: centralized observability (Thanos/Mimir receiving remote-write from every cluster; Grafana with per-cluster datasources), centralized logs (S3 + one search tier), identity (OIDC provider per account, roles via Terraform). Rollout strategy: wave deploys (dev → prod-wave-1 → prod-wave-2) with automated canary analysis. Cost: each cluster = $73 control plane — consolidate where tenancy allows.

---

---

# OBSERVABILITY DEEP-DIVE (the interview's stated focus)

## Architecture & Prometheus

**Q106. Design the observability stack for this cluster from scratch. What do you install on day 1?**
Baseline: kube-prometheus-stack (Prometheus + Alertmanager + Grafana + node-exporter + kube-state-metrics) via Helm in an add-ons Terraform layer; EKS control-plane logs → CloudWatch (5 types); Fluent Bit DaemonSet for container stdout → CloudWatch Logs or OpenSearch/Loki; metrics-server (present) for HPA. Then: OTel collectors (DaemonSet + Deployment gateway) for traces/metrics pipelines, Tempo/Jaeger or X-Ray backend; dashboards as code (Grafana provisioning from Git); alerts as code (PrometheusRule CRDs in GitOps). Retention: Prometheus local 7–15d + remote-write to Mimir/Thanos/AMP (Amazon Managed Prometheus) for 13-month capacity planning. Long-term answer should name *why* each piece, not just brand names.

**Q107. How does Prometheus scrape this cluster? Service discovery mechanics.**
Prometheus uses kubernetes_sd_configs: watches the API server for nodes/pods/services/endpoints slices; relabeling rules map k8s metadata to targets (e.g., scrape pods annotated `prometheus.io/scrape: "true"`). scrape interval 15–30s typical; each target = endpoint+job; kubelet cadvisor endpoints give container CPU/mem; kube-state-metrics turns object state (deployments, pending pods, restarts) into metrics; node-exporter (DaemonSet, hostNetwork) gives node-level USE metrics. TLS + bearer token to kubelet; honor_labels, sample limits as guardrails.

**Q108. What is the cardinality problem? Concrete example and fixes.**
Cardinality = product of distinct label values per metric. A `http_requests_total{path,status,pod}` with `/users/{id}` unnormalized = unbounded series → memory blowup, slow queries, TSDB churn. Rules: never label by unbounded values (user IDs, full URLs, timestamps); drop/aggregate at the source (relabel `metric_relabel_configs` drop, or instrumentation path templating); keep per-series churn in check; budget: ~a few million active series per Prometheus. Measure: `prometheus_tsdb_head_series`, top-k by `count by (__name__)({__name__=~".+"})`. Cardinality is the #1 self-inflicted Prometheus outage.

**Q109. PromQL: write these. (a) 5-min error ratio for a service; (b) p95 latency; (c) CPU throttling; (d) pod restarts in the last hour; (e) node disk filling in < 4h.**
```promql
# (a)
sum(rate(http_requests_total{status=~"5..",service="api"}[5m]))
  / sum(rate(http_requests_total{service="api"}[5m]))
# (b)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="api"}[5m])) by (le))
# (c)
rate(container_cpu_cfs_throttled_seconds_total{namespace="prod"}[5m])
# (d)
increase(kube_pod_container_status_restarts_total[1h]) > 0
# (e)
predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[1h], 4*3600) < 0
```
Know why `rate` needs counters, why `histogram_quantile` needs `by (le)`, and why `irate` for spiky/graphing vs `rate` for alerting.

**Q110. Prometheus HA and long-term storage: options and trade-offs.**
Two replicas scraping identical targets (dedup at query in Thanos/Cortex/Mimir via external labels + sidecar or remote-write receiver). Options: (a) **AMP (Amazon Managed Prometheus)** — ops-light, remote-write in, pay per sample; (b) **Thanos** — sidecar uploads blocks to S3, querier fans out, cheap infinite retention, more moving parts; (c) **Mimir/Cortex** — multi-tenant remote-write store, horizontally scalable, heaviest to run. Federation is legacy for rollups. Choose by team size: small team → AMP; cost-sensitive DIY → Thanos on S3.

**Q111. Recording rules — what and why; give two you'd add here.**
Precompute expensive expressions into new series (eval interval ~30s): faster dashboards, stable alert inputs, reduced query load. Examples: `job:error_rate:5m = sum(rate(http_requests_total{status=~"5.."}[5m])) by (job) / sum(rate(http_requests_total[5m])) by (job)` and `node:disk_utilization:ratio = 1 - node_filesystem_avail/node_filesystem_size`. Naming convention `level:metric:operation`.

**Q112. Alertmanager: routing, grouping, inhibition, silences — design for this platform.**
Grouping (by cluster/namespace/alertname) batches related alerts into one notification; `group_wait/group_interval/repeat_interval` control cadence (e.g., 30s/5m/4h). Routing tree: `severity=critical` → PagerDuty, `warning` → Slack, per-team receivers by namespace label. **Inhibition**: node-down suppresses that node's pod alerts; cluster-level alert mutes downstream noise. Silences: time-boxed mutes for maintenance (tie to change calendar). HA: Alertmanager cluster gossip; dedupe via external labels. And every alert links a runbook annotation.

**Q113. Multi-window multi-burn-rate alerting — explain and produce an example for a 99.9% SLO.**
Error budget 0.1%. Burn rate = actual error ratio / allowed ratio. Alert when budget depletes too fast over both a short and long window (short ensures it's ongoing, long filters blips): page at burn 14.4 over 1h+5m (2% budget/hour); ticket at burn 3 over 6h+30m; slow burn 1 over 3d. Example pair:
```yaml
- alert: ErrorBudgetBurnFast
  expr: |
    job:error_rate:1h > 14.4 * 0.001
    and job:error_rate:5m > 14.4 * 0.001
  for: 2m
  labels: {severity: critical}
```
Why it beats static thresholds: alerts scale with budget consumption, one framework covers fast catastrophes and slow leaks, and it's directly tied to the SLO.

**Q114. SLIs for Kubernetes itself — how do you SLO a cluster?**
Control plane: API availability (successful `kubectl`/client calls / total — excluding 4xx), API latency (p99 for GET/LIST/POST per resource), etcd latency (via EKS metrics/CloudWatch `etcd` latencies where exposed), scheduler binding latency. Data plane: pod startup time (image pull + schedule + ready), kubelet heartbeat health, node NotReady ratio, DNS resolution success/latency (CoreDNS `coredns_dns_request_duration_seconds`), LB provisioning time. Set SLOs per tenant-facing platform feature, not per component vanity metric.

**Q115. CloudWatch Container Insights vs Prometheus/Grafana on EKS — when which?**
Container Insights: agent DaemonSet (that `CloudWatchAgentServerPolicy` on the node role), zero-config cluster/node/pod metrics + performance log events, native AWS integration, alarm integration; costs per metric/GB, proprietary, weaker query language (Metrics Insights/Logs Insights QL), dashboards less rich, retention fixed tiers. Prometheus: open standard (huge exporter ecosystem, PromQL, Grafana), app custom metrics natural, but you own scaling/HA/storage. Common real world: Prometheus for metrics/SLOs + CloudWatch Logs for control-plane logs (only option) + optionally AMP to get managed Prometheus. Know both; don't be dogmatic.

## Logging & tracing

**Q116. Design the logging pipeline for this cluster; what are the failure modes?**
Apps log JSON to stdout (12-factor) → container runtime → Fluent Bit DaemonSet tails `/var/log/containers/*.log`, enriches with k8s metadata (namespace/pod/labels) via the kubernetes filter → outputs: CloudWatch Logs (simple) / OpenSearch (search) / S3+Athena (cheap long-term) / Loki (label-indexed, pairs with Grafana). Failure modes: log volume spikes saturating node disk (buffer limits, `storage.total_limit_size`), backpressure to the output (retry limits, drop vs block policy), multiline stack traces split (multiline parser), timezone/format chaos (enforce JSON + UTC), high-cardinality index explosion in OpenSearch, cost blowout in CloudWatch ingestion ($0.50/GB + retention) → sample/route noisy namespaces to S3. Log redaction for PII/secrets at the agent or app layer.

**Q117. How do you correlate logs, metrics, traces? Concrete implementation.**
Trace context (`traceparent`/W3C) propagated by instrumentation (OTel SDK/auto-instrumentation). Exemplars link Prometheus histograms → trace IDs. Logs include `trace_id`/`span_id` fields (OTel logging instrumentation) → one click from log line to trace. Consistent `service.name`, `deployment.environment`, `k8s.namespace` resource attributes across all three signals (OTel semantic conventions) → Grafana correlates natively. Tempo/Loki/Prometheus all keyed on the same labels.

**Q118. Distributed tracing on EKS: architecture and sampling strategy.**
OTel Collector as DaemonSet (agent: receive from pods on localhost, k8sattributes processor enriches) → gateway collectors (load balancing, tail sampling) → backend (Tempo/Jaeger/X-Ray). Head sampling (at SDK): simple, biased, drops rare-but-interesting errors. **Tail sampling** (at collector): decide after the trace completes — keep errors, high latency, rare routes; sample the rest (e.g., keep 100% errors + 10% baseline). Cost: network/egress and storage dominate; set span attribute limits, drop health-check spans at the source (`/healthz` filtered).

**Q119. eBPF-based observability (Cilium Hubble, Pixie, Coralogix/Groundcover, Beyla) — what changes vs classic agents?**
Kernel-level visibility without app changes: per-flow network maps, L7 protocol visibility, syscall-level signals, near-zero instrumentation toil; great for golden signals on services you don't own. Trade-offs: kernel version requirements, overhead at extreme scale, cardinality of flow data, maturity. Position: complement (not replacement) for Prometheus — eBPF gives breadth cheaply, instrumentation gives depth (business metrics).

**Q120. What Kubernetes events tell you, and how do you make them useful operationally?**
Events are the cluster's narrative (scheduling decisions, pulls, kills, probe failures, evictions) — but they expire (~1h) and live per-namespace. Operationalize: export via an event exporter to your log system (retention + search), alert on specific reasons (`FailedScheduling`, `OOMKilling`, `NodeNotReady`, `BackOff`), use `kubectl get events --sort-by=.lastTimestamp` in triage. Pair with `kubectl describe` as first-response tools.

**Q121. Dashboards: design the "one pane" for this platform.**
Hierarchy: (1) Executive/SLO: per-service availability vs SLO, error budget remaining, burn-rate sparklines; (2) Service (RED): rate/errors/duration + dependencies; (3) Platform: cluster health — node capacity vs requested/limits, pod phase counts, restart rates, control-plane API latency/error, etcd, CoreDNS; (4) Node/USE: CPU/mem/disk/net + saturation (throttling, conntrack, ENI/IP exhaustion for EKS!); (5) Cost: Kubecost per namespace. Every panel links to logs/traces; dashboards provisioned from Git (Jsonnet/grizzly/terraform grafana provider), reviewed in PRs like code.

## Incident scenarios (observability-flavored)

**Q122. PagerDuty: "API p99 latency 10x baseline for 10 minutes." Walk your investigation end-to-end.**
1) Scope via dashboards: which service/endpoint? (latency by route) — global or one dependency? 2) Golden signals: error rate? traffic spike? saturation? 3) Check recent changes: deploys (annotate dashboards with deploy markers — GitOps revision), config changes, Terraform applies. 4) Drill: RED on the service → traces for slow spans (which hop?) → dependency metrics (DB connections, downstream latency) → node-level (CPU throttle? `container_cpu_cfs_throttled_seconds_total`; memory pressure? disk I/O?). 5) Common culprits on EKS: CPU throttling from tight limits (raise limits or remove CPU limits per current best practice), HPA maxed while a dependency slows (queue buildup), DNS latency (conntrack/nodelocal), noisy neighbor on shared node, spot node degraded (interrupt/replace), EBS burst balance exhausted. 6) Mitigate (rollback / scale / restart stuck), communicate (status page cadence), then postmortem: 5-whys, action items (alert tuning, capacity, runbook), blameless.

**Q123. Pods restarting cluster-wide; restarts correlate with nothing deployed. What are your top hypotheses and how do you discriminate?**
`kubectl get events` + `kube_pod_container_status_restarts_total` by node/namespace. Hypotheses: (a) node-level: memory pressure evictions (check `kubelet` events, node-exporter mem, OOMKilled exit 137), disk pressure, CPU credit exhaustion on t3a; (b) spot interruption (CloudTrail/EC2 events — time-correlate); (c) kubelet/CNI flapping (aws-node logs); (d) a dependency causing crashloops (liveness probe failing on downstream timeout — probe config bug: liveness failing on transient dependency errors is a self-DoS; liveness should check process health only); (e) control plane issues (apiserver restarts). Discriminate: is it one node or many? one namespace or all? exit codes (137=OOM/sigkill, 1=app)? probe failure events?

**Q124. "The cluster is fine but customers say checkout fails 5% of the time." Where do you look when infra metrics are green?**
This is why infra metrics alone are insufficient: application SLIs first — distributed tracing on the checkout path (which span errors?), logs with trace IDs for those failures, dependency health (payment provider status — external synthetic checks!), feature flags/experiments, partial failures masked by retries (retry storms amplifying a flaky dependency — look at retry counts), client-side errors (RUM). Lesson to articulate: monitor from the user's perspective (synthetics + RUM + SLOs), not from the server's perspective only.

**Q125. Your Prometheus is OOMing weekly. Diagnose and fix.**
Causes: cardinality explosion (new label added by a team — `topk` series by metric, check `prometheus_tsdb_head_series` growth vs deploys), too many targets/scrape volume, retention too long for disk, expensive federation/recording loops, remote-write queue backpressure growing memory (WAL). Fixes: drop offending labels via `metric_relabel_configs`, sample limits per scrape (`sample_limit`), shard by namespace (or move to Mimir/AMP), tune `--storage.tsdb.retention.*`, head compaction/OOO settings, vertical scale + query-only replicas (Thanos querier offloads). Prevent: cardinality budget alerts, CI check on new metrics (promtool rules lint + cardinality review), per-team namespaces with scrape quotas.

**Q126. How do you monitor the spot capacity risk on this cluster?**
Signals: CloudWatch/EventBridge rebalance recommendations & interruption notices (Node Termination Handler exposes metrics/events), `karpenter`/ASG capacity events, spot placement scores, per-AZ spot price trends. Alerts: rebalance recommendation on the only node (page — you're one node deep!), ASG unable to launch spot (capacity-optimized diversification: multiple instance types/families/AZs), fallback to on-demand when spot unavailable (`capacity_type` mixed policy). Tie to SLO: budget consumption attributable to interruptions feeds the spot-vs-on-demand business case.

**Q127. What would you alert on for EKS specifically? Give a top-10 list.**
1) API server 5xx/latency SLO burn; 2) Node NotReady > N min; 3) Unschedulable pods pending > 5m (capacity); 4) CrashLoopBackOff / restart-rate spikes per workload; 5) OOMKills; 6) CoreDNS error/latency (SERVFAIL ratio); 7) ENI/IP exhaustion per subnet (`aws-node` ipamd metrics / free IPs < threshold); 8) control-plane log anomalies (authenticator denials spike, RBAC escalation audit events — security); 9) certificate expiry (kubelet/client, webhooks); 10) PV failures (`FailedAttachVolume`, `FailedMount`) + disk-fill prediction. Plus: event-based alerts (spot interruption, add-on degradation via `aws_eks_addon` health / `AddonIssue`).

**Q128. SLIs you would NOT alert on, and why?**
CPU utilization alone (saturation ≠ user impact; throttling metrics matter more), memory % (caches use free RAM; watch OOMs/working set), disk usage static threshold without prediction (use `predict_linear`), pod count changes (normal autoscaling), individual container restarts (crashloops as a *rate/pattern* matter, single restarts are healthy k8s behavior). Principle: alert on symptoms requiring human action; everything else is a dashboard.

**Q129. How do you test your monitoring? (A question seniors get asked.)**
Game days/chaos: kill a node (or spot-simulate), saturate CPU, break DNS policy — verify alerts fire, runbooks resolve, dashboards show it; alert unit tests (`promtool test rules`); synthetic canaries continuously exercising golden paths (so monitoring always has signal); alertmanager route tests in staging; "dead man's switch" (an always-firing heartbeat alert to a webhook — if *it* stops, your pipeline is down); postmortem action tracking: every incident ends with "what alert should have caught this sooner?"

**Q130. Observability at scale: cost control strategies.**
Metrics: drop unused metrics/labels (analyze with `mimirtool analyze prometheus`), recording-rule pre-aggregation, longer scrape intervals for low-value jobs, per-team cardinality budgets. Logs: level discipline (no DEBUG in prod), sampling/head-based filtering of noisy sources, route by namespace to different tiers (hot OpenSearch 7d → warm → S3/Parquet+Athena for compliance), avoid CloudWatch ingestion for high-volume chatty services. Traces: tail sampling, span attribute limits. Storage: downsampling for long-term (Thanos compact 5m/1h resolutions), retention aligned to actual query patterns (capacity planning needs 13 months of *downsampled*, not raw). Measure cost per service/team — showback via labels, exactly like the `default_tags` discipline in this repo.

---

---

# LIVE CODING / "MODIFY THIS PROJECT" TASKS (with solutions)

The interviewer said they may ask you to code or modify the project. These are the most
probable tasks, each with a working patch sketch.

## Task 1 — "Move the nodes to private subnets" ⭐ most likely
`modules/vpc/main.tf`:
```hcl
  azs             = var.availability_zones
  public_subnets  = [for i, az in var.availability_zones : cidrsubnet(var.cidr, 8, i)]
  private_subnets = [for i, az in var.availability_zones : cidrsubnet(var.cidr, 8, i + 100)]

  enable_nat_gateway = true
  single_nat_gateway = true   # demo cost saver; prod = one per AZ

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
    Type                              = "private"
  }
```
`modules/vpc/outputs.tf`: add `output "private_subnet_ids" { value = module.vpc.private_subnets }`.
Root `main.tf`: `subnet_ids = module.vpc.private_subnet_ids` (nodes), and pass
`module.vpc.public_subnet_ids` as a second arg for the control-plane ENIs if desired.
Explain while coding: NAT per AZ for prod HA; node group change is a rolling replacement;
control-plane subnet change is a control-plane update; expect ~15 min apply; watch pod egress
afterward (NAT IP allowlists with partners change!).

## Task 2 — "Lock down the public API endpoint"
`modules/eks/main.tf`:
```hcl
  cluster_endpoint_public_access       = true
  cluster_endpoint_public_access_cidrs = var.api_allowed_cidrs  # e.g. office/VPN egress IPs
  cluster_endpoint_private_access      = true
```
Follow-up they want: how does CI reach it then? (GitHub-hosted runners have ephemeral IPs →
either keep public+allowlist, use self-hosted runners inside the VPC, larger runners with static
egress IPs, or OIDC→VPN. Full-private needs in-VPC runners or a proxy.)

## Task 3 — "Add IRSA for a workload" (e.g., app needs S3 read)
New file in `modules/iam` (or a dedicated `irsa` module):
```hcl
resource "aws_iam_role" "app" {
  name = "${var.name}-app-s3"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.cluster_oidc_provider_arn }  # module.eks.oidc_provider_arn
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${replace(var.cluster_oidc_issuer, "https://", "")}:sub" = "system:serviceaccount:app:app-sa"
          "${replace(var.cluster_oidc_issuer, "https://", "")}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}
```
Plus the least-privilege S3 policy, and the ServiceAccount annotation. Note the root needs
`cluster_oidc_provider_arn = module.eks.oidc_provider_arn` wired in — and mention the *cycle
lesson* from Q46: pass the OIDC ARN out, never feed the cluster name back in.

## Task 4 — "Enable control plane logging"
```hcl
  enabled_cluster_log_types            = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  cloudwatch_log_group_retention_in_days = 30
```
Talking points: cost per GB, audit-policy volume, ship to S3 for long-term, alert on
`forbid` RBAC escalation events.

## Task 5 — "Add a second, on-demand node group for critical workloads"
```hcl
    ondemand = {
      name           = "${var.cluster_name}-ondemand"
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = ["t3a.large"]
      capacity_type  = "ON_DEMAND"
      min_size = 1; max_size = 3; desired_size = 1
      taints = { critical = { key = "workload", value = "critical", effect = "NO_SCHEDULE" } }
    }
```
Workloads get matching toleration + nodeAffinity. Explain taint effects, why not just "use on-demand everywhere" (cost), and PDB/anti-affinity for the critical pods.

## Task 6 — "Install the EBS CSI driver (stateful workloads)"
```hcl
resource "aws_eks_addon" "ebs_csi" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "aws-ebs-csi-driver"
  service_account_role_arn = module.ebs_csi_irsa.arn  # IRSA required
  depends_on               = [module.eks]
}
```
Then a `gp3` StorageClass with `volumeBindingMode: WaitForFirstConsumer`. Explain why the in-tree
provisioner is gone (CSIMigration complete by 1.27+) and why IRSA (the driver calls EC2 APIs).

## Task 7 — "Add Prometheus/Grafana observability via Terraform"
Add the `helm` provider (same exec auth as the kubernetes provider) and:
```hcl
resource "helm_release" "kube_prometheus_stack" {
  name       = "monitoring"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"
  create_namespace = true
  values = [yamlencode({
    grafana      = { adminPassword = "..." }  # or better: external secret
    prometheus   = { prometheusSpec = { retention = "7d" } }
  })]
  depends_on = [module.eks]
}
```
Discuss: two-pass apply problem (provider-depends-on-cluster, Q49), why a separate add-ons
state is cleaner, and that AMG/AMP are the managed alternatives.

## Task 8 — "Make ECR production-grade"
```hcl
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  encryption_configuration { encryption_type = "KMS" }
```
Deploys switch to digest pinning (`image = "repo@sha256:..."` in manifests — GitOps-friendly
with image updater). Lifecycle policy: protect tagged releases (`tagPrefixList`), expire
untagged after 7 days.

## Task 9 — "Harden the CI role" (remove AdministratorAccess)
Sketch the split: `tf-plan` role (read-only + state read), `tf-apply` role scoped to the
services Terraform manages (ec2, eks, iam-limited with a permissions boundary, ecr,
elasticloadbalancing, logs, kms), `deploy` role (ecr push + namespace-scoped EKS admin).
Say out loud: "AdministratorAccess exists in the demo on purpose — the comment says so —
and this is exactly how I'd phase it out; first deny iam:* except PassRole to known roles."

## Task 10 — "Add validation / guardrails"
Variable validations (Q52), plus:
```hcl
resource "terraform_data" "guard" {
  lifecycle {
    precondition {
      condition     = var.node_min_size >= 1 && var.node_max_size >= var.node_min_size
      error_message = "Sizing must satisfy 1 <= min <= max."
    }
  }
}
```
Also: `check` blocks (TF 1.5+) for post-apply assertions, `moved` blocks for refactors,
`removed` blocks (TF 1.7+) for clean decommissioning.

## Task 11 — "Multi-environment support"
Show the directory layout, not just talk:
```
envs/
  dev/main.tf   → module "stack" { source = "../../" ... } with dev tfvars + dev backend
  prod/main.tf  → same module, prod tfvars, separate state key, stricter CI approval
```
Explain why not workspaces for prod (Q51), and how promotion is a PR between env dirs.

## Task 12 — "Fix the hidden module cycle risk"
Delete the unused `cluster_name` variable from `modules/iam` (and the root wiring), or pass
`var.cluster_name` (statically known) instead of `module.eks.cluster_name`. Explain the
would-be cycle (Q46) — this shows you actually know your own code's sharp edges.

## Task 13 — "Add cost monitoring / tagging enforcement"
`default_tags` exist — extend with `CostCenter`, `Owner`; enable AWS Cost Explorer +
budgets via Terraform (`aws_budgets_budget`); mention Kubecost for in-cluster allocation;
enforce tags with an SCP or `aws_config` rule.

## Task 14 — "Write a GitHub Actions workflow that deploys using this setup"
```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: ${{ vars.AWS_ROLE_ARN }}   # output of this repo
      aws-region: us-east-1
      role-session-name: GHA-${{ github.run_id }}
  - run: aws ecr get-login-password | docker login --username AWS --password-stdin $ECR
  - run: docker build -t $ECR:$SHA . && docker push $ECR:$SHA
  - run: aws eks update-kubeconfig --name eksdemo
  - run: kubectl set image deployment/app app=$ECR:$SHA
```
Narrate the security: OIDC, no stored keys, session name for CloudTrail, protected
`environment:` for prod, and immutable image tags by SHA (ties to Task 8).

## Task 15 — "kubectl is broken for me in prod" (whiteboard troubleshooting)
Check exec plugin (`aws eks get-token` works? creds expired? wrong profile?), endpoint
reachability (`curl -k https://<endpoint>/healthz` → 401 means network OK, auth failing —
401 is *good*), access entry exists for your principal (`aws eks list-access-entries`),
clock skew (STS signature failures), proxy/SSL inspection breaking TLS to the endpoint.

---

# RAPID-FIRE (one-liner answers)

- **Terraform refresh-only plan**: `terraform plan -refresh-only` — update state to reality, show drift, change nothing.
- **Untaint**: `terraform untaint` — rarely right; prefer fixing the resource.
- **`-target`**: surgical applies; last resort — creates state/config skew.
- **`moved` block**: state-level refactor without destroy/create.
- **HCL types**: string, number, bool, list, set, map, object, tuple. `set` = unordered unique.
- **`for_each` vs `count`**: for_each keyed by stable keys → no mass-replacement on reorder.
- ** locals**: named intermediate values; computed once, referenced many.
- **EKS service CIDR**: cluster-local ClusterIP range (typically 172.20.0.0/16), can't overlap VPC... actually it *can* be outside VPC — pod traffic never routes to it directly (kube-proxy DNATs first).
- **Core add-ons**: vpc-cni, kube-proxy, coredns (+ pod identity agent optional).
- **Cluster SG vs node SG**: control-plane ENIs vs workers; module wires both directions.
- **`AmazonEKSClusterAdminPolicy` scope**: `cluster` or `namespace` — least privilege uses namespace.
- **IMDSv2**: hop-limited token metadata; AL2023 enforces v2 → blocks SSRF credential theft patterns; pods get IMDS blocked by hop limit 1 (CNI default) — that's intentional.
- **`kubectl api-resources`**: list installed APIs incl. CRDs.
- **etcd object limit**: ~1.5 MiB per object; don't stuff blobs in ConfigMaps.
- **Exit 137**: SIGKILL — usually OOMKill; 143 = SIGTERM.
- **`kubectl top` needs**: metrics-server (installed here as add-on).
- **Prometheus 4 metric types**: counter, gauge, histogram, summary.
- **Histogram vs summary**: histograms aggregate across instances (server-side buckets + `le`); summaries compute quantiles client-side, not aggregable.
- **RED / USE / Four Golden Signals / LET**: Rate-Errors-Duration; Utilization-Saturation-Errors; Latency-Traffic-Errors-Saturation; Latency-Errors-Traffic.
- **Blameless postmortem**: focus on system conditions, not individuals; action items with owners/dates.
- **Toil**: manual, repetitive, automatable, scales with service — SRE's enemy; cap ~50%.
- **Error budget policy**: budget exhausted → release freeze + reliability work.
- **`terraform state mv` / `rm` / `pull` / `push`**: surgery tools; `pull` for backup before risky ops.
- **DynamoDB lock item key**: `LockID` (String) = `bucket/key-md5`.
- **S3 lockfile (TF≥1.10)**: `use_lockfile = true` in backend — DynamoDB no longer needed.

---

# QUESTIONS YOU SHOULD ASK THEM (senior signals)

- "How does the team currently do on-call — rotation size, escalation, and what's the page volume like?"
- "What's the current state of SLOs — defined, measured, enforced?"
- "How do platform and product teams split responsibility for the clusters?"
- "What's the toil ratio, and what's being done about it?"
- "Can you describe a recent incident and what changed afterward?"
- "How are deploys gated today, and who owns the Kubernetes/platform roadmap?"

---

# PREP CHECKLIST (night before)

- [ ] Rehearse the 90-second pitch out loud; be ready to whiteboard the architecture (4 modules + backend + CI).
- [ ] Know your own numbers: /16 → two /24s, 251 usable IPs, 17 pods on t3a.medium, $73/mo control plane, min/max 1/2, SPOT, 1.31.
- [ ] Be able to type from memory: private-subnet patch (Task 1), validation block, IRSA trust policy, one burn-rate alert.
- [ ] Have the "weaknesses" list (§3) in your head — volunteer them before they find them; it reads as senior self-awareness.
- [ ] Prepare 2–3 real production stories (incident you led, toil you automated, money you saved) in STAR format — they will ask.
- [ ] `terraform validate && terraform fmt -check` clean; know exactly what `tfplan` in the repo contains (your last plan — be ready to explain it).
