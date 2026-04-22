# Backup & Restore Runbook (DB-4)

## Scope

Aziro Ops stores the durable application state (events, snapshots, analyses, users, audit_log, …) in Postgres 16. This runbook covers:

- What gets backed up, how often, and where it's stored
- How to restore from a backup (manual procedure for disaster recovery)
- How to rotate the MinIO credentials
- What the nightly restore drill does and what to page on when it fails
- Retention policy and how it's enforced

Scope **does not** include SQLite dev backups (SQLite is dev-only — losing a dev laptop's `aziro.db` is expected).

---

## Architecture

```
 ┌────────────┐      ┌─────────────┐       ┌──────────────┐
 │ postgres   │◀─────│  backup     │──────▶│  minio       │
 │  :5432     │      │  sidecar    │       │  :9000       │
 │            │      │  (alpine +  │       │              │
 │            │      │   pg_dump + │       │  aziro-      │
 │            │      │   mc + jq)  │       │   backups/   │
 └────────────┘      └─────────────┘       │   YYYY/MM/DD/│
                            ▲              └──────────────┘
                            │ docker exec
                     ┌─────────────┐
                     │  ofelia     │  daemon mode: reads labels on
                     │             │  the backup container to learn
                     │             │  02:00 UTC → backup.sh
                     │             │  02:30 UTC → restore-verify.sh
                     └─────────────┘
```

All four services (`postgres`, `backup`, `minio`, `ofelia`) run in the same docker-compose project. Ofelia invokes scripts via `docker exec` against the backup sidecar; neither backup.sh nor restore-verify.sh runs inside the postgres or minio container.

Backup scripts are in [`ops/backup/`](../../ops/backup/). Compose wiring lives in [`docker-compose.yml`](../../docker-compose.yml).

---

## What gets backed up

Every night at **02:00 UTC**, `backup.sh` runs:

1. `pg_dump --format=custom --compress=9 --no-owner --no-privileges` against the live `aziro` database
2. Uploads the resulting `.dump` file to MinIO at `aziro-backups/YYYY/MM/DD/db-<stamp>.dump`
3. Emits a JSON log line (`{"component":"aziro-backup","msg":"backup complete",…}`) that Loki scrapes

`--format=custom` is chosen because it's the only format that supports selective restore (you can restore a single table, skip triggers, etc.). Plain SQL dumps would work but are larger and less flexible.

**Not backed up** (deliberately):
- Redis — rate-limit counters, sessions, pub/sub fan-out. Ephemeral by design; losing it kicks users out of live sessions but doesn't corrupt durable state.
- MinIO itself — the bucket holds backups of Postgres. Losing MinIO means losing the backups; losing Postgres is the scenario the backups recover from. The volume has `restart: unless-stopped`; for true DR, replicate `aziro-minio-data` to a second host or push dumps to AWS S3 (change `MINIO_ENDPOINT` in `.env`; the script flow is unchanged).

---

## Nightly restore drill

Thirty minutes after backup runs, `restore-verify.sh` proves the dump is actually restorable:

1. `mc ls --recursive` + `sort | tail -1` finds the newest dump
2. Creates a scratch database `aziro_verify` on the same Postgres server (uses the existing `shared_preload_libraries` setting)
3. `pg_restore --exit-on-error` into the scratch DB
4. `pg_dump --schema-only` both live and scratch, `diff` — any drift is a hard failure
5. `SELECT COUNT(*) FROM events` on both — fails if restored count < live count (guards against a silent empty-dump regression; risk #6 in db-v1-plan.md)
6. `DROP DATABASE … WITH (FORCE)` on the scratch DB (also runs via `trap cleanup EXIT` so an aborted drill doesn't wedge the next run)

Exit 0 means tonight's backup is known-good. Exit 1 means **page ops** — something in the backup chain is broken and the current protection is stale.

### Monitoring the drill

Loki query for the nightly run:
```
{com_aziro_service="backup"} | json | component="aziro-restore-verify"
```

Alert rule (LogQL, add to your alertmanager):
```
sum by (level) (count_over_time({com_aziro_service="backup"} | json | component="aziro-restore-verify" [26h])) == 0
  → "no restore-verify logs in >26 hours — ofelia or backup sidecar down"

sum by (level) (count_over_time({com_aziro_service="backup"} | json | component="aziro-restore-verify" | level="error" [26h])) > 0
  → "restore-verify failed in the last 26 hours — investigate immediately"
```

---

## Manual restore (disaster recovery)

You are here because Postgres is corrupt / lost / a migration blew up. The steps below restore the most recent backup into a fresh Postgres container, then cut the app over.

### Prerequisites

- `.env` with `POSTGRES_PASSWORD`, `AZIRO_DB_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` matching the environment you're restoring to
- The MinIO bucket `aziro-backups` is still reachable (MinIO on same compose project, or swap `MINIO_ENDPOINT` to S3/R2)
- Rough idea of which day to restore from (usually "last night" unless the corruption was pre-2am)

### Steps

1. **Stop the aziro service so no new writes go into the broken DB.**
   ```
   docker compose stop aziro
   ```

2. **If the Postgres volume is salvageable, back up what's there first.** Even a corrupt volume holds data a dump can't always recover; a filesystem-level copy is cheap insurance.
   ```
   docker run --rm -v aziro-pg-data:/src -v $(pwd)/salvage:/dst alpine:3.19 \
     sh -c 'cd /src && tar czf /dst/pg-data-$(date +%Y%m%dT%H%M%S).tgz .'
   ```

3. **Recreate the Postgres volume.**
   ```
   docker compose down postgres
   docker volume rm aziro-pg-data
   docker compose up -d postgres
   ```
   Wait for `pg_isready` (compose healthcheck handles this automatically).

4. **Apply the schema.** Alembic owns all DDL; run it against the fresh DB before restoring data.
   ```
   docker compose exec aziro python -m scripts.db upgrade
   ```
   This is faster than letting `pg_restore` recreate the schema because Alembic uses one transaction per migration — and it matches what live looks like.

5. **Pull the dump from MinIO.** List what's available first:
   ```
   docker compose exec backup mc ls --recursive aziro/aziro-backups/
   ```
   Pick the one you want (usually the newest; specify a date path if you need an older one):
   ```
   docker compose exec backup mc cp \
     aziro/aziro-backups/2026/04/22/db-20260422T020000Z.dump \
     /tmp/restore.dump
   ```

6. **Restore data only** (schema is already there from step 4):
   ```
   docker compose exec backup pg_restore \
     --dbname="postgresql://aziro:$POSTGRES_PASSWORD@postgres:5432/aziro" \
     --data-only \
     --disable-triggers \
     --exit-on-error \
     /tmp/restore.dump
   ```
   `--disable-triggers` is required because FK checks would fire during the load and complain about order. pg_restore handles the re-enable.

7. **Sanity check row counts.**
   ```
   docker compose exec postgres psql -U aziro -d aziro -c "
     SELECT 'events' AS tbl, COUNT(*) FROM events
     UNION ALL SELECT 'users', COUNT(*) FROM users
     UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log;
   "
   ```
   Compare against the operator's expectation / last-known-good snapshot.

8. **Bring the app back up.**
   ```
   docker compose start aziro
   ```
   Hit the UI, make sure login works, confirm the events stream is live.

9. **Write it up.** Add an entry to `docs/ops/incident-log.md` (even if it's just "restored from backup YYYY/MM/DD without issue"). Future-you will want the timing / byte counts when sizing the next DR drill.

**Expected data loss**: up to 24 hours, bounded by the nightly backup cadence. If you need sub-day RPO, you're looking at PITR (write-ahead log shipping) — out of scope for v1.0; would be a DB-5 PR.

---

## Rotating MinIO credentials

The root credential is a shared secret between the MinIO container and the backup sidecar. Rotation is the response to a suspected compromise (e.g., `.env` accidentally committed and pushed to a public repo).

### Procedure

1. **Generate the new password.**
   ```
   python3 -c "import secrets;print(secrets.token_urlsafe(32))"
   ```

2. **Update `.env` on every host** running the compose project:
   ```
   MINIO_ROOT_PASSWORD=<new-value>
   ```

3. **Restart the affected services.** MinIO reads the root password at startup:
   ```
   docker compose up -d minio backup ofelia
   ```

4. **Verify** the backup sidecar can still authenticate:
   ```
   docker compose exec backup mc alias set aziro http://minio:9000 \
     "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
   docker compose exec backup mc ls aziro/aziro-backups/
   ```
   The `ls` should succeed without a "Access Denied" error.

5. **Run a manual backup** to confirm end-to-end:
   ```
   docker compose exec backup /usr/local/bin/backup.sh
   ```
   Watch Loki for `"msg":"backup complete"`.

**What if the old password was public long enough for someone to read data?** Assume any dump older than the rotation is potentially compromised. Policy options: delete older dumps (loses history), migrate them to a new bucket (preserves history, rolls the exposure window). No one-size-fits-all answer; depends on the data sensitivity classification.

---

## Retention

- **30 days** by default, enforced by a MinIO lifecycle rule (`mc ilm rule add --expire-days 30`)
- Applied idempotently by `minio-bucket-init.sh` every time the backup sidecar starts
- Change via `BACKUP_RETENTION_DAYS=N` in `.env` — re-run `minio-bucket-init.sh` once to apply
- MinIO's ILM scanner runs on a ~hourly interval, so objects may linger up to 60 min past expiry before actual deletion

### Why not longer?

Dumps compress to ~5-30% of DB size depending on content. A 1 GB DB → ~100 MB/dump → 3 GB/month. At 30 days of retention the backup volume stays small enough that a single-host deployment doesn't need a separate disk. For compliance retention (e.g., "7 years of financial data"), extend retention AND replicate to S3 Glacier — MinIO isn't the long-term vault.

---

## Troubleshooting

### `backup.sh` exits with `pg_dump failed`

Almost always a connection issue — check that `AZIRO_DB_URL` in the sidecar's env matches the running Postgres and that Postgres is healthy:
```
docker compose exec postgres pg_isready -U aziro -d aziro
docker compose exec backup env | grep AZIRO_DB_URL
```

### `restore-verify.sh` logs `schema drift detected`

The dump's schema doesn't match live. Most common cause: an Alembic migration ran on live after the backup was taken but before the verify ran (e.g., you upgraded in the middle of the night). Inspect:
```
docker compose exec backup diff /tmp/live-schema.sql /tmp/restored-schema.sql | head -50
```
If the diff is "live has new table X, restored doesn't" — benign, next night's backup will include it, alert clears. If the diff is the other direction, you dropped something and should investigate.

### `restore-verify.sh` logs `row count regression`

Restored events count is less than live. Either the dump is empty/truncated (check `mc stat` on the file; should be > 0 bytes), or events were deleted between backup and verify (legitimate but rare — confirm nothing is purging `events` outside the retention rule).

### MinIO `503 Service Unavailable` on `mc ls`

The lifecycle scanner holds locks during GC; transient 503s under heavy ILM are normal. Retry. If persistent, check the minio container logs for disk-full or permission errors on `/data`.

### Ofelia not firing jobs

Daemon mode discovers jobs by reading docker labels. If the schedule labels are missing from the backup service or the `/var/run/docker.sock` mount is broken, ofelia silently runs with zero jobs. Check:
```
docker compose logs ofelia | grep -i "job\|schedule"
```
Should show two "scheduled job" lines at startup.

---

## Risk register (backups-specific)

Extracted from [db-v1-plan.md](../db-v1-plan.md) risk register:

| # | Risk | Mitigation |
|---|------|-----------|
| 6 | Restore-verify silently passes an empty dump | Row-count smoke check in `restore-verify.sh` |
| 7 | MinIO bucket compromise leaks PII | Private bucket (enforced in `minio-bucket-init.sh`), root credential rotation procedure above, restore-verify sandboxed in a scratch DB |

## v1.0 exit-gate items

- [ ] First nightly cron has produced a dump in MinIO (check `mc ls aziro/aziro-backups/`)
- [ ] `restore-verify.sh` has exited 0 at least once against a real dump (Loki shows a `"msg":"restore-verify complete"` line)
- [ ] Manual restore drill executed once (this runbook, end-to-end) and timed — note duration in `docs/ops/incident-log.md`
- [ ] MinIO lifecycle rule confirmed active: `mc ilm rule ls aziro/aziro-backups/` shows the `aziro-retention` rule

---

## See also

- [Chaos Drills Runbook](./chaos-drills.md) — on-demand `run-backup-drill` wraps `backup.sh` + `restore-verify.sh` for manual pre-release verification; `kill-postgres` drill verifies the LB probe contract (healthz/readyz) behaves correctly when Postgres is down.
