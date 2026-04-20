"""
gunicorn.conf.py — production WSGI server settings.

Why gevent, not sync or thread workers?
- Chat streaming (SSE) + monitor subscriptions hold connections open for
  minutes at a time. Sync workers would tie up a process per streaming
  client; thread workers share GIL on I/O-light request lifecycles.
- gevent's async I/O model lets one worker service many long-lived
  streams with negligible overhead. Matches how Flask's dev server was
  being (mis)used in production.

Env overrides (read at boot):
  AZIRO_HOST           default 0.0.0.0
  AZIRO_PORT           default 5000
  AZIRO_GUNICORN_WORKERS        default 2 (low — each worker can handle
                                many concurrent streams via gevent)
  AZIRO_GUNICORN_WORKER_CONNECTIONS   default 1000
  AZIRO_GUNICORN_TIMEOUT        default 120 (seconds) — SSE streams
                                need to exceed the default 30s
  PROMETHEUS_MULTIPROC_DIR      if set, workers write metric shards here
                                and /metrics aggregates them (RUN-3)

The sync dev server (app.py) stays available for local iteration — this
file is only read when someone runs `gunicorn -c gunicorn.conf.py ...`.
"""
import glob
import os

bind = f"{os.environ.get('AZIRO_HOST', '0.0.0.0')}:{os.environ.get('AZIRO_PORT', '5000')}"

workers = int(os.environ.get("AZIRO_GUNICORN_WORKERS", "2"))
worker_class = "gevent"
worker_connections = int(os.environ.get("AZIRO_GUNICORN_WORKER_CONNECTIONS", "1000"))

# SSE streams hold the socket open; the default 30s would kill them
# mid-response. 120s matches our chat stream upper bound.
timeout = int(os.environ.get("AZIRO_GUNICORN_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5

# Recycle workers to cap any slow memory growth; randomized so all N
# workers don't recycle at the same moment under steady load.
max_requests = 1000
max_requests_jitter = 100

# Disable gunicorn's access log — ui.web's _request_log_middleware()
# already emits a structured "request" log per /api/ call with richer
# fields (request_id, duration_ms) and skips static-asset noise. Two
# access logs per request would just clutter the stream and double the
# cost of log ingestion.
accesslog = None
errorlog = "-"
loglevel = os.environ.get("AZIRO_GUNICORN_LOGLEVEL", "info")

# Where to locate the WSGI app. Gunicorn invocation:
#   gunicorn -c gunicorn.conf.py ui.web:app
wsgi_app = "ui.web:app"


# ── Prometheus multi-process mode (RUN-3) ─────────────────────────────────────
# Every gunicorn worker has its own in-memory metric registry. Scraping one
# worker at random returns 1/N of reality. prometheus_client fixes this by
# having workers write shard files to PROMETHEUS_MULTIPROC_DIR; the /metrics
# handler uses MultiProcessCollector to aggregate them on each scrape.
#
# Our hooks:
#   on_starting  — create the dir and clear stale shards from a prior boot.
#                  Must happen BEFORE workers fork, hence `on_starting`.
#   child_exit   — mark a worker's shards dead so histograms stop counting
#                  it. Without this, crashed workers' data lingers forever.

def on_starting(server):
    mp_dir = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if not mp_dir:
        return
    os.makedirs(mp_dir, exist_ok=True)
    # Stale shards from a previous boot would be attributed to new PIDs.
    for path in glob.glob(os.path.join(mp_dir, "*.db")):
        try:
            os.unlink(path)
        except OSError:
            pass  # best-effort; a racing worker can recreate it


def child_exit(server, worker):
    if not os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return
    try:
        from prometheus_client import multiprocess
        multiprocess.mark_process_dead(worker.pid)
    except Exception:
        # Never let a metrics-side failure crash gunicorn's worker reaper.
        pass
