# Backup sidecar — runs scheduled pg_dump → MinIO uploads + restore drills.
#
# Kept tiny (alpine + libpq client + mc + jq) so startup is fast and the
# image is cheap to rebuild when alpine security patches come out. The
# sidecar sleeps forever by default; ofelia invokes the scripts via
# `docker exec` on the schedule set in docker-compose.yml labels.
#
# Architecture: the sidecar reads AZIRO_DB_URL (a psycopg DSN) and
# strips the `+psycopg` suffix in-script before handing it to pg_dump,
# so .env stays the single source of truth for the DSN.
FROM alpine:3.19

# postgresql16-client gives us pg_dump / pg_restore / psql that match
# the server version pinned in docker-compose.yml. jq is used by the
# scripts to emit structured JSON logs Loki can parse. bash is only for
# `set -o pipefail`; the scripts stay POSIX where possible.
RUN apk add --no-cache \
    postgresql16-client \
    bash \
    jq \
    tzdata \
    curl \
    ca-certificates

# mc (MinIO client) isn't in the alpine main repo — pull the official
# binary. Pinned to a specific release so rebuilds are reproducible.
# Update this hash when bumping versions; see MINIO_MC_SHA256 in the
# compose comment for verification guidance.
ARG MC_VERSION=RELEASE.2025-04-08T15-39-49Z
RUN curl -fsSL \
      "https://dl.min.io/client/mc/release/linux-amd64/archive/mc.${MC_VERSION}" \
      -o /usr/local/bin/mc \
 && chmod +x /usr/local/bin/mc \
 && mc --version

# mc writes its per-alias config under $HOME/.mc; /tmp is the only
# reliably-writable dir inside a locked-down sidecar.
ENV HOME=/tmp
ENV MC_CONFIG_DIR=/tmp/.mc

COPY backup.sh restore-verify.sh minio-bucket-init.sh /usr/local/bin/
RUN chmod +x \
      /usr/local/bin/backup.sh \
      /usr/local/bin/restore-verify.sh \
      /usr/local/bin/minio-bucket-init.sh

# Default: sleep forever so the container stays up for ofelia to exec
# into. Restart policy in compose.yml handles crashes; no app logic
# lives in CMD.
CMD ["sleep", "infinity"]
