-- scripts/pg-init.sql — runs once on first Postgres container boot.
--
-- Mounted at /docker-entrypoint-initdb.d/pg-init.sql by docker-compose.yml.
-- The postgres:16-alpine entrypoint executes every .sql in that directory
-- exactly once, against an empty data dir, as the POSTGRES_USER superuser.
-- Subsequent boots skip it — the volume retains the initialised state.
--
-- Keep this file minimal. Schema lives in Alembic (`python -m scripts.db
-- upgrade`); this file is strictly for extensions that must exist before
-- the first migration applies or that require superuser privileges.

-- pg_stat_statements lets ops see slow-query patterns without a separate
-- exporter. Loaded via shared_preload_libraries at the postgres.conf level
-- in future (OPS-3 load test will decide whether to wire that in); the
-- CREATE EXTENSION is cheap either way.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
