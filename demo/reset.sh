#!/usr/bin/env bash
# Tear down the demo namespace and redeploy from scratch. Use when
# the demo has drifted (pods deleted, images changed, rehearsal left
# things inconsistent).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

kubectl delete namespace demo --ignore-not-found --wait=true
"$DIR/deploy.sh"
