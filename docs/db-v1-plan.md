# v1.0 Durable State Plan — DB-1 through DB-4

Owner: backend / platform
Scope: everything behind `store/`, `auth/`, rate-limit storage, SSE fan-out,
and backup/restore. Targets v1.0.0.

This document is the contract. TODO.md tracks status; design decisions
and rollback strategy live here.

## Goals

1. **Portability** — same app code runs on SQLite (dev, tests) and Postgres
   16 (prod) without branching on `engine.dialect.name` in business logic.
2. **No data loss during migration** — verified cut-over from existing
   SQLite file to Postgres, with a rehearsed restore drill before we flip.
3. **Horizontal-ready** — Redis replaces in-memory rate-limit counters and
   monitor SSE queues so a second gunicorn worker (or a second host) does
   not duplicate alerts or silently bypass limits.
4. **Operable** — `alembic upgrade head` is the only schema-change command
   an operator runs; `pg_dump` + MinIO + a `restore-verify.sh` script is
   the only backup story.

Non-goals for v1.0: sharding, read replicas, TimescaleDB, row-level
security, logical replication. All deferred to post-v1.0 (see TODO.md
`Deferred infra`).

## Architecture

```
┌─────────────┐     ┌─────────────────────────────┐     ┌──────────────┐
│ gunicorn w1 │────▶│ SQLAlchemy Core engine      │────▶│ Postgres 16  │
│ gunicorn w2 │────▶│   (sqlite:// or postgres+   │     │   (prod)     │
│             │     │    psycopg://)              │     └──────────────┘
│ ui/web.py   │     └─────────────────────────────┘            │
│ agent/      │                                                 │
│ store/      │     ┌─────────────────────────────┐     ┌──────────────┐
│ auth/       │◀───▶│ Redis 7                     │     │ MinIO (S3)   │
│             │     │  - flask-limiter storage    │     │  pg_dump     │
│             │     │  - monitor pub/sub          │     │  backups     │
│             │     │  - flask-session server     │     │  30d retain  │
│             │     └─────────────────────────────┘     └──────────────┘
└─────────────┘                                                ▲
                                                               │
                                                      nightly cron
```

SQLite stays the default so `pytest` and `./start.sh` work without docker
dependencies. Prod flips a single env var to switch engines.

## Four-PR sequence

Each PR is independently mergeable and independently revertable. The
order matters: B depends on A's engine, C depends on A's Alembic, D
depends on C's Postgres.

### PR-A — SQLAlchemy Core + Alembic dual-backend (DB-1)

Branch: `fix/db-1-sqlalchemy-core`

**Adds**
- `sqlalchemy>=2.0`, `alembic>=1.13`, `psycopg[binary]>=3.2` to `requirements.txt`
- `store/engine.py` — single `create_engine(AZIRO_DB_URL)` with pool sizing
  (`pool_pre_ping=True`, `pool_size=10`, `max_overflow=10` on Postgres;
  `StaticPool` + `check_same_thread=False` on SQLite for tests)
- `store/schema.py` — `sqlalchemy.MetaData` with every existing table
  declared via `Table(...)` (events, snapshots, analyses, users,
  audit_log, llm_usage, etc.). Column types are dialect-portable
  (`Integer`, `String(…)`, `DateTime(timezone=True)`, `Text`, `JSON`)
- `alembic/` — `alembic.ini`, `env.py` that reads `AZIRO_DB_URL`,
  `versions/0001_baseline.py` that creates every current table + index
- `scripts/db.py` — `python -m scripts.db upgrade|downgrade|current`
  wrapper so ops does not need alembic CLI knowledge

**Changes**
- `store/db.py` — every `self._conn.execute(SQL, (…))` rewritten as
  `with engine.begin() as conn: conn.execute(text(SQL), {…})`. Keep the
  class shape identical so ui/web.py is unchanged.
- `auth/db.py` — same treatment.
- `conftest.py` — uses in-memory SQLite (`sqlite+pysqlite:///:memory:`)
  with schema created from `store.schema.metadata.create_all(engine)`

**Does NOT change**
- Any SQL semantics. The baseline Alembic revision is a literal transcription
  of what `_init_schema` creates today. No column renames, no type widens.
- Public method signatures on `Store` or `AuthStore`.

**Acceptance**
- Full pytest suite passes on SQLite (`AZIRO_DB_URL` unset)
- Full pytest suite passes on Postgres 16
  (`AZIRO_DB_URL=postgresql+psycopg://…` via docker-compose fixture)
- `alembic upgrade head` on a fresh Postgres produces a schema `pg_dump`
  diff-identical to what our migration script expects
- `alembic downgrade base` drops everything cleanly (paired downgrade tested)

**Rollback**
- Revert the PR. No data loss risk — SQLite file is untouched; we did not
  introduce a new storage location. Prod is not on Postgres yet.

### PR-B — Redis 7 integration (DB-2)

Branch: `fix/db-2-redis`

**Adds**
- `redis>=5.0`, `flask-session>=0.6` to `requirements.txt`
- `redis:7-alpine` service in `docker-compose.yml` with named volume
  `aziro-redis-data` and `--appendonly yes` for durability
- `observability/redis_client.py` — lazy singleton returning
  `redis.Redis.from_url(AZIRO_REDIS_URL)`; returns `None` when unset
  (dev fallback)
- `AZIRO_RATELIMIT_STORAGE_URI` wired into `Limiter(storage_uri=…)` in
  `ui/web.py`; defaults to `memory://` if unset
- Monitor SSE fan-out — events publish to `redis` channel
  `aziro:monitor`; each worker subscribes and relays to its connected
  clients. Falls back to in-process queue if Redis unavailable.
- `flask-session` with `SESSION_TYPE=redis` in prod; `SESSION_TYPE=filesystem`
  in dev

**Changes**
- `ui/web.py` — Limiter init, SessionInterface wiring, monitor subscribe
  in a background gevent greenlet
- `healthz/readyz` — readyz adds `redis.ping()` when `AZIRO_REDIS_URL` set

**Acceptance**
- Two gunicorn workers + a Redis container: a POST to `/api/v1/chat/stream`
  from worker A triggers `429 Too Many Requests` on worker B once the
  limit is hit (proves storage is shared)
- Manual test: alert fires on one worker, SSE client connected to the other
  worker still receives it (proves pub/sub fan-out)
- Tests stub Redis with `fakeredis` so unit suite stays dependency-free

**Rollback**
- Unset `AZIRO_REDIS_URL`. Limiter falls back to `memory://`, sessions fall
  back to filesystem, monitor falls back to in-process. Zero data migration.

### PR-C — Postgres 16 production migration (DB-3)

Branch: `fix/db-3-postgres-prod`

**Adds**
- `postgres:16-alpine` service in `docker-compose.yml` with named volume
  `aziro-pg-data`, `POSTGRES_DB=aziro`, `POSTGRES_USER=aziro`,
  `POSTGRES_PASSWORD` from `.env`
- `scripts/migrate_sqlite_to_pg.py` — reads from `store/aziro.db`, writes
  to target Postgres via `AZIRO_DB_URL`. Modes:
  - `--dry-run` → row counts per table, no writes
  - `--execute` → copy in a single transaction; aborts if any row fails
  - `--verify` → post-hoc row-count + checksum comparison per table
- `scripts/pg-init.sql` — `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`
  (loaded by the postgres container on first boot)
- `.env.example` — adds `AZIRO_DB_URL=postgresql+psycopg://aziro:…@postgres:5432/aziro`

**Changes**
- `docker-run.sh` — detects `AZIRO_DB_URL`; if present, waits for postgres
  to accept connections before starting the app
- CI matrix — runs pytest on both SQLite and Postgres 16 (GHA services)
  **Note**: deferred to OPS-2 if Jenkins is not yet in place; keep the
  makefile target so it's ready

**Acceptance**
- Fresh docker-compose up boots postgres → runs `alembic upgrade head` →
  app comes up green on `/readyz`
- `migrate_sqlite_to_pg.py --dry-run` against our production SQLite
  snapshot shows expected row counts
- `migrate_sqlite_to_pg.py --execute --verify` on a staging snapshot
  produces zero verification errors
- Load-test harness (from OPS-3) hits p95 < 500ms on 50 concurrent users

**Rollback**
- If verification fails: the SQLite file was not modified by the migration
  script, and `AZIRO_DB_URL` can be unset to revert to SQLite-backed
  operation. No destructive change until operator flips the env.
- If the cut-over is already live and we hit corruption: restore most
  recent `pg_dump` + point `AZIRO_DB_URL` at the restored DB (exercised
  in PR-D's restore drill).

### PR-D — Backup + restore automation (DB-4)

Branch: `fix/db-4-backups`

**Adds**
- `minio:latest` service in `docker-compose.yml` (S3-compatible,
  self-hosted) with named volume `aziro-minio-data`
- `scripts/backup.sh` — `pg_dump --format=custom --compress=9` →
  `mc cp` to MinIO bucket `aziro-backups/YYYY/MM/DD/db.dump`
- `scripts/restore-verify.sh` — downloads latest dump, restores to a
  scratch Postgres container, runs `pg_dump --schema-only` diff against
  live schema, exits non-zero on mismatch
- Nightly cron in `docker-compose.yml` (ofelia or a simple cron container):
  runs `backup.sh` at 02:00, `restore-verify.sh` at 02:30, posts result
  to structlog / Loki
- `docs/ops/backup-restore.md` — runbook: what to do when a backup fails,
  how to restore to a point in time, retention policy, who gets paged

**Acceptance**
- Fresh install: first nightly cron produces a dump in MinIO, verify
  script exits 0
- Kill the Postgres volume, restore from latest dump, app comes up green
  with all users + sessions + audit log intact
- 30-day retention holds: backups older than 30 days are garbage-collected
  by a MinIO lifecycle rule

**Rollback**
- Disable the cron. Backup bucket and scripts are inert until invoked.
  No risk to production data.

## Schema rules (binding for all four PRs)

1. **All timestamps are `DateTime(timezone=True)`** — never naive. SQLite
   stores as ISO8601 strings; Postgres stores as `TIMESTAMPTZ`. Application
   code uses `datetime.now(timezone.utc)`.
2. **Primary keys are `Integer` autoincrement** where we own the ID;
   `String(36)` UUID where an external system does. No surrogate keys
   on top of natural keys.
3. **Foreign keys always declared** with `ON DELETE CASCADE` where the
   relationship is a parent-owns-child (events → snapshots), `ON DELETE
   SET NULL` where child outlives parent (audit_log → users).
4. **Indexes** are named `idx_<table>_<cols>` and live alongside the
   table definition in `store/schema.py`. Alembic migrations must
   include them — never `CREATE INDEX` out-of-band.
5. **No dialect-specific column types** in `store/schema.py`. If we need
   JSON columns, use `sqlalchemy.JSON` (maps to `JSONB` on Postgres,
   `TEXT` on SQLite with a TypeDecorator).
6. **Migration file naming**: `YYYYMMDD_HHMM_<slug>.py` so `ls
   alembic/versions/` sorts chronologically. Alembic's default hash
   prefix is preserved for collision safety.
7. **Every migration has a working `downgrade()`**. CI runs `alembic
   upgrade head && alembic downgrade base && alembic upgrade head` to
   verify.

## Risk register

| # | Risk | Mitigation | Severity |
|---|------|-----------|----------|
| 1 | Existing SQLite `_init_schema` and Alembic baseline drift | PR-A includes a `tests/test_schema_parity.py` that compares `metadata` DDL against what `_init_schema` produces | High |
| 2 | Long-running SELECT blocks writer on SQLite busy_timeout | Keep SQLite dev-only; prod is Postgres where MVCC handles this | Medium |
| 3 | `json` column portability (SQLite TEXT vs PG JSONB) | Use `sqlalchemy.JSON` TypeDecorator uniformly; test round-trip on both | Medium |
| 4 | Flask-Limiter key collisions after switching to Redis | Prefix all keys with `aziro:rl:`; verify with `redis-cli KEYS` in staging | Low |
| 5 | Monitor SSE pub/sub loses events during worker restart | Events are also durably written to `events` table; pub/sub is a hot path, not the source of truth | Low |
| 6 | Backup verify script silently passes an empty dump | `restore-verify.sh` asserts `row_count(events) > 0` (or whatever smoke threshold makes sense) before succeeding | Medium |
| 7 | MinIO bucket compromise leaks PII in dumps | Dumps live behind MinIO's access key; bucket policy denies public access; restore-verify runs in a sandboxed container | Medium |
| 8 | Alembic migration half-applied in prod | Every migration is wrapped in a transaction (Postgres DDL is transactional); failed migrations roll back cleanly | Low |

## v1.0 exit gate (for this workstream)

All four PRs merged AND:
- [ ] Prod running on Postgres 16 for 7 consecutive days without a
      connection pool exhaustion event
- [ ] One successful restore drill executed against a real backup
      (logged in runbook)
- [ ] k6 load test (50 concurrent users, 10 SSE streams, 10 min) hits
      p95 < 500ms with Postgres + Redis
- [ ] `docs/ops/backup-restore.md` reviewed and filed under DOCS-1
- [ ] All SEC/RUN/OPS tests green on both SQLite and Postgres CI matrices

## Open decisions (lock before PR-A merges)

1. **Redis scope** — all three uses in PR-B, or split sessions into a later PR?
   _Proposed: all three, single PR. Sessions share the storage, so splitting
   just doubles the compose churn._
2. **Backup target** — MinIO, or simpler `pg_dump` + `rsync` to a second host?
   _Proposed: MinIO. Single-binary, self-hosted, S3 API lets us swap to real
   S3 later without code changes._
3. **`AZIRO_AUTO_MIGRATE` default in prod** — on app boot, run
   `alembic upgrade head`?
   _Proposed: off (default 0). Operator runs migrations explicitly; app boot
   should be idempotent and fast. Dev/CI can flip it on via `.env`._
4. **Postgres on Jenkins vs GHA** — our CI is moving to Jenkins (OPS-2).
   Do we test both backends in Jenkins, or land Postgres CI in GHA first
   and migrate when Jenkins arrives?
   _Proposed: keep the `make test-postgres` target engine-agnostic so whichever
   CI we land first can invoke it._
