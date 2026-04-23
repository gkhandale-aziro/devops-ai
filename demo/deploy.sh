#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

kubectl apply -f "$DIR/app.yaml"
kubectl apply -f "$DIR/broken.yaml"

echo ""
echo "Demo deployed to namespace: demo"
echo ""
kubectl -n demo get all
