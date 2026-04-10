# syntax=docker/dockerfile:1
# =============================================================================
# Aziro Ops — Production Dockerfile
# =============================================================================
# Multi-stage parallel build: each CLI downloads in its own stage concurrently,
# then only the binaries are copied into the slim final image.
#
# Requires DOCKER_BUILDKIT=1 (default since Docker 23.0+).
#
# Build:   docker build -t aziro-ops .
# Run:     docker run -p 5000:5000 -v aziro-data:/app/data --env-file .env aziro-ops
#
# Estimated image size:  ~800 MB   (vs 1.5 GB+ monolithic)
# Estimated build time:  ~2-3 min  (vs 10+ min serial, <30s warm cache)
# =============================================================================

# ── Version pins — change one, only that stage rebuilds ──────────────────────
ARG KUBECTL_VERSION=1.31.4
ARG AWS_CLI_VERSION=2.22.35
ARG AZ_CLI_VERSION=2.85.0
ARG TERRAFORM_VERSION=1.9.8
ARG HELM_VERSION=3.16.4
ARG DOCKER_VERSION=27.5.1

# =============================================================================
# Stage: kubectl — static binary (~50 MB)
# =============================================================================
FROM alpine:3.20 AS cli-kubectl
ARG KUBECTL_VERSION
RUN wget -q "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
        -O /usr/local/bin/kubectl && chmod +x /usr/local/bin/kubectl

# =============================================================================
# Stage: AWS CLI v2 — installed into /opt, only binaries copied (~60 MB)
# =============================================================================
FROM python:3.12-slim AS cli-aws
ARG AWS_CLI_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip && \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
        -o /tmp/awscli.zip && \
    unzip -q /tmp/awscli.zip -d /tmp && \
    /tmp/aws/install --install-dir /opt/aws-cli --bin-dir /opt/aws-bin && \
    rm -rf /tmp/aws /tmp/awscli.zip /var/lib/apt/lists/*

# =============================================================================
# Stage: Google Cloud SDK — official slim image as build stage
# =============================================================================
FROM google/cloud-sdk:slim AS cli-gcloud
# slim variant includes gcloud + gke-gcloud-auth-plugin, ~180 MB.

# =============================================================================
# Stage: Azure CLI — installed via pip (lighter than the 600 MB official image,
# and avoids glibc/Python mismatch when COPY --from into Debian slim)
# =============================================================================
FROM python:3.12-slim AS cli-azure
ARG AZ_CLI_VERSION
RUN pip install --no-cache-dir --target /opt/az azure-cli==${AZ_CLI_VERSION}

# =============================================================================
# Stage: Terraform — static binary (~80 MB)
# =============================================================================
FROM alpine:3.20 AS cli-terraform
ARG TERRAFORM_VERSION
RUN wget -q "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" \
        -o /dev/null -O /tmp/tf.zip && \
    unzip -q /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip

# =============================================================================
# Stage: Helm — static binary (~50 MB)
# =============================================================================
FROM alpine:3.20 AS cli-helm
ARG HELM_VERSION
RUN wget -q "https://get.helm.sh/helm-v${HELM_VERSION}-linux-amd64.tar.gz" -O /tmp/helm.tgz && \
    tar xz -f /tmp/helm.tgz --strip-components=1 -C /usr/local/bin linux-amd64/helm && \
    rm /tmp/helm.tgz

# =============================================================================
# Stage: Docker client — static binary, no daemon (~60 MB)
# =============================================================================
FROM alpine:3.20 AS cli-docker
ARG DOCKER_VERSION
RUN wget -q "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
        -O /tmp/docker.tgz && \
    tar xz -f /tmp/docker.tgz --strip-components=1 -C /usr/local/bin docker/docker && \
    rm /tmp/docker.tgz

# =============================================================================
# Stage: Python deps — venv + pip install (runs parallel with CLI stages)
# =============================================================================
FROM python:3.12-slim AS python-deps
WORKDIR /app
RUN python -m venv /app/venv
COPY requirements.txt .
RUN /app/venv/bin/pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Stage: Frontend — build React SPA (runs parallel with CLI + Python stages)
# =============================================================================
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ .
RUN npm run build

# =============================================================================
# Final stage — slim runtime with all CLIs + app
# =============================================================================
FROM python:3.12-slim

# System tools used by sandbox/safe.py whitelist and tool modules
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates openssh-client git \
        procps net-tools iproute2 iputils-ping dnsutils \
        traceroute sysstat \
    && rm -rf /var/lib/apt/lists/*

# ── Copy CLIs from parallel build stages ─────────────────────────────────────
COPY --from=cli-kubectl   /usr/local/bin/kubectl      /usr/local/bin/kubectl
COPY --from=cli-aws       /opt/aws-cli                /opt/aws-cli
COPY --from=cli-aws       /opt/aws-bin/               /usr/local/bin/
COPY --from=cli-gcloud    /usr/lib/google-cloud-sdk   /usr/lib/google-cloud-sdk
COPY --from=cli-azure     /opt/az                     /opt/az
COPY --from=cli-terraform /usr/local/bin/terraform    /usr/local/bin/terraform
COPY --from=cli-helm      /usr/local/bin/helm         /usr/local/bin/helm
COPY --from=cli-docker    /usr/local/bin/docker       /usr/local/bin/docker

# Symlink gcloud + az wrapper onto PATH
RUN ln -sf /usr/lib/google-cloud-sdk/bin/gcloud    /usr/local/bin/gcloud    && \
    ln -sf /usr/lib/google-cloud-sdk/bin/gsutil    /usr/local/bin/gsutil    && \
    ln -sf /usr/lib/google-cloud-sdk/bin/gke-gcloud-auth-plugin \
                                                   /usr/local/bin/gke-gcloud-auth-plugin && \
    printf '#!/bin/sh\nPYTHONPATH=/opt/az exec python3 -m azure.cli "$@"\n' \
           > /usr/local/bin/az && chmod +x /usr/local/bin/az

# ── Python venv + application code ───────────────────────────────────────────
WORKDIR /app
COPY --from=python-deps /app/venv /app/venv
ENV PATH="/app/venv/bin:/usr/lib/google-cloud-sdk/bin:$PATH"

COPY . .

# ── Overwrite stale frontend_dist with freshly-built SPA from build stage ────
COPY --from=frontend-build /app/frontend_dist /app/frontend_dist

# ── Non-root user — runs the app with reduced privileges ────────────────────
RUN groupadd -r aziro && useradd -r -g aziro -d /home/aziro -s /bin/false aziro && \
    mkdir -p /home/aziro /app/data && \
    chown -R aziro:aziro /app /home/aziro
ENV HOME=/home/aziro

ENV AZIRO_DATA_DIR=/app/data
ENV AZIRO_KEY_FILE=/app/data/.aziro_key

USER aziro

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fs http://localhost:5000/ || exit 1

CMD ["python", "app.py"]
