#!/usr/bin/env bash
# =============================================================================
# Aziro Ops — Docker launcher
# =============================================================================
# Architecture:
#   Host credentials → mounted read-only at /home/aziro/.host-*
#   Cloud CLIs → pointed to host mounts via env vars
#   kubeconfig → host (read-only) + container (writable) merged via KUBECONFIG
#   New cluster setups from UI → write to /app/data/.kube/ on the data volume
#
# Usage:
#   ./docker-run.sh              # start
#   ./docker-run.sh --rebuild    # rebuild image first
#   docker rm -f aziro-ops       # stop
# =============================================================================

set -e

IMAGE="aziro-ops"
NAME="aziro-ops"

if [[ "$1" == "--rebuild" ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Building image..."
    DOCKER_BUILDKIT=1 docker build -t "$IMAGE" .
fi

docker rm -f "$NAME" 2>/dev/null || true

# Ensure credential dirs exist — empty is fine, live bind mount picks up
# any future writes (aws configure, gcloud auth login, etc.)
mkdir -p ~/.kube ~/.aws ~/.config/gcloud ~/.azure ~/.ssh

echo "Starting $NAME..."
docker run -d --name "$NAME" \
    -p 5000:5000 \
    \
    -v aziro-data:/app/data \
    \
    -v "$HOME/.kube:/home/aziro/.host-kube:ro" \
    -v "$HOME/.aws:/home/aziro/.host-aws:ro" \
    -v "$HOME/.config/gcloud:/home/aziro/.host-gcloud:ro" \
    -v "$HOME/.azure:/home/aziro/.host-azure:ro" \
    -v "$HOME/.ssh:/home/aziro/.ssh:ro" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    \
    -e AZIRO_DATA_DIR=/app/data \
    -e AZIRO_KEY_FILE=/app/data/.aziro_key \
    -e "KUBECONFIG=/home/aziro/.host-kube/config:/app/data/.kube/config" \
    -e AWS_SHARED_CREDENTIALS_FILE=/home/aziro/.host-aws/credentials \
    -e AWS_CONFIG_FILE=/home/aziro/.host-aws/config \
    -e CLOUDSDK_CONFIG=/home/aziro/.host-gcloud \
    -e AZURE_CONFIG_DIR=/home/aziro/.host-azure \
    \
    --add-host=host.docker.internal:host-gateway \
    --env-file .env \
    "$IMAGE"

echo ""
echo "Aziro Ops → http://localhost:5000"
echo ""
echo "Add credentials on the host anytime — no restart needed:"
echo "  aws configure                  → AWS targets"
echo "  gcloud auth login              → GCP targets"
echo "  az login                       → Azure targets"
echo "  ssh-keygen / ssh-copy-id       → SSH targets"
echo ""
echo "Add clusters from the UI → kubeconfig written to data volume."
