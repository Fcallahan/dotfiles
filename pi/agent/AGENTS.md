# Infrastructure

We run **EKS with EC2 node groups, not Fargate**, across our AWS devops. Default every deployment
target, Terraform/manifest suggestion, and architecture diagram to EKS-on-EC2 — Deployments/
Services/Ingress via the AWS Load Balancer Controller, IRSA for pod-level AWS access, EC2 worker
nodes (not Fargate profiles) — unless a project explicitly says otherwise. (Confirmed by the
`Karpenter-<cluster>-*` SQS interruption queues present across environments in the `ems` AWS
account — Karpenter provisions EC2 capacity, not Fargate.)
