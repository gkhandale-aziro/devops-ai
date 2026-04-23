#!/usr/bin/env bash
# Re-break the worker deployment after an AI-assisted fix, so the demo
# can be re-run without a full reset. Only touches demo-store-worker.
set -euo pipefail

kubectl -n demo set image deployment/demo-store-worker \
    worker=nginx:9.99.99-does-not-exist

echo "Worker deployment re-broken. Wait ~10s then verify:"
echo "  kubectl -n demo get pods -l app.kubernetes.io/component=worker"
