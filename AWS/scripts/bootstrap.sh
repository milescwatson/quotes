#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACCOUNT_ID="${1:?Usage: bootstrap.sh VERIFIED_ACCOUNT_ID}"
export AWS_PROFILE="${AWS_PROFILE:-quotes-development}"
export AWS_REGION="${AWS_REGION:-us-west-2}"
ACTUAL_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACTUAL_ACCOUNT" == "$ACCOUNT_ID" ]] || { echo "Wrong AWS account; stopping." >&2; exit 1; }
export TF_VAR_account_id="$ACCOUNT_ID"
export TF_VAR_region="$AWS_REGION"
terraform -chdir="$ROOT/bootstrap" init
terraform -chdir="$ROOT/bootstrap" plan -out=bootstrap.tfplan
terraform -chdir="$ROOT/bootstrap" apply bootstrap.tfplan
BUCKET="$(terraform -chdir="$ROOT/bootstrap" output -raw state_bucket)"
# Bootstrap initially uses local state, then migrates it into the protected bucket.
if [[ ! -f "$ROOT/bootstrap/backend.tf" ]]; then
  cat > "$ROOT/bootstrap/backend.tf" <<BACKEND
terraform {
  backend "s3" {
    bucket = "$BUCKET"
    key = "bootstrap/terraform.tfstate"
    region = "$AWS_REGION"
    encrypt = true
    use_lockfile = true
  }
}
BACKEND
  terraform -chdir="$ROOT/bootstrap" init -migrate-state -force-copy
fi
cat > "$ROOT/environments/development/backend.hcl" <<BACKEND
bucket = "$BUCKET"
key = "development/terraform.tfstate"
region = "$AWS_REGION"
encrypt = true
use_lockfile = true
BACKEND
terraform -chdir="$ROOT/environments/development" init -backend-config=backend.hcl
