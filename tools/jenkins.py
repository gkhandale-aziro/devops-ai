"""
tools/jenkins.py — query Jenkins over its REST JSON API.

Jenkins does not expose a shell; it speaks HTTP. So unlike the other
executors (which shell out to a CLI), `run_jenkins` receives a small set
of pseudo-commands (e.g. "list_jobs", "list_queue") and translates each
into an authenticated HTTP GET, returning a rendered text table.

Auth: HTTP Basic with username + API token (Jenkins → User → Configure
→ API Token). Token is stored encrypted by TargetManager.
"""
import json
import ssl
import base64
import urllib.request
import urllib.error
from datetime import datetime, timezone

_TIMEOUT = 15
_MAX_OUTPUT_CHARS = 3000


def _auth_header(config):
    user  = config.get("username", "").strip()
    token = config.get("api_token", "").strip()
    if not user or not token:
        return None
    raw = f"{user}:{token}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _http_get(config, path):
    """GET <jenkins-url>/<path> with Basic auth. Returns (ok, body_or_error)."""
    base = config.get("url", "").strip().rstrip("/")
    if not base:
        return False, "[ERROR] Jenkins URL is not configured"

    url = f"{base}/{path.lstrip('/')}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    auth = _auth_header(config)
    if auth:
        req.add_header("Authorization", auth)

    verify = config.get("verify_ssl", "").strip()
    ctx = None
    if verify == "0":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT, context=ctx) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return True, body
    except urllib.error.HTTPError as e:
        return False, f"[ERROR] HTTP {e.code} from Jenkins: {e.reason}"
    except urllib.error.URLError as e:
        return False, f"[ERROR] Could not reach Jenkins at {base}: {e.reason}"
    except Exception as e:
        return False, f"[ERROR] {type(e).__name__}: {e}"


def _fmt_table(headers, rows):
    widths = [len(h) for h in headers]
    for r in rows:
        for i, cell in enumerate(r):
            widths[i] = max(widths[i], len(str(cell)))
    header_line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    out = [header_line]
    for r in rows:
        out.append("  ".join(str(c).ljust(widths[i]) for i, c in enumerate(r)))
    return "\n".join(out)


def _color_to_status(color):
    """Jenkins encodes job status in a CSS-like 'color' field."""
    if not color:
        return "unknown"
    mapping = {
        "blue":        "success",
        "blue_anime":  "running",
        "red":         "failed",
        "red_anime":   "running",
        "yellow":      "unstable",
        "yellow_anime":"running",
        "grey":        "pending",
        "grey_anime":  "running",
        "disabled":    "disabled",
        "aborted":     "aborted",
        "notbuilt":    "notbuilt",
    }
    return mapping.get(color, color)


def _ts_to_str(ms):
    if not ms:
        return "-"
    try:
        dt = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return "-"


def _duration_str(ms):
    if not ms:
        return "-"
    try:
        s = int(ms) // 1000
        if s < 60:  return f"{s}s"
        m = s // 60
        if m < 60:  return f"{m}m{s % 60}s"
        h = m // 60
        return f"{h}h{m % 60}m"
    except Exception:
        return "-"


def _truncate(text):
    if len(text) > _MAX_OUTPUT_CHARS:
        return text[:_MAX_OUTPUT_CHARS] + f"\n... [truncated — showing first {_MAX_OUTPUT_CHARS} chars]"
    return text


# ── pseudo-command handlers ──────────────────────────────────────────────────

def _cmd_test(config):
    ok, body = _http_get(config, "api/json?tree=mode,nodeName,numExecutors")
    if not ok:
        return body
    try:
        data = json.loads(body)
        return (f"Jenkins control plane OK\n"
                f"  mode: {data.get('mode', '?')}\n"
                f"  node: {data.get('nodeName', '?')}\n"
                f"  executors: {data.get('numExecutors', '?')}")
    except json.JSONDecodeError:
        return f"[ERROR] Jenkins returned non-JSON response:\n{body[:200]}"


def _cmd_list_jobs(config, pipelines_only=False):
    tree = "jobs[name,url,color,_class,lastBuild[number,result,timestamp,duration]]"
    ok, body = _http_get(config, f"api/json?tree={tree}")
    if not ok:
        return body
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return f"[ERROR] Invalid JSON from Jenkins:\n{body[:200]}"

    jobs = data.get("jobs", [])
    if pipelines_only:
        jobs = [j for j in jobs if "Workflow" in j.get("_class", "") or "pipeline" in j.get("_class", "").lower()]

    if not jobs:
        return "No jobs found." if not pipelines_only else "No pipelines found."

    rows = []
    for j in jobs:
        last = j.get("lastBuild") or {}
        rows.append([
            j.get("name", "-"),
            _color_to_status(j.get("color", "")),
            f"#{last.get('number')}" if last.get("number") else "-",
            last.get("result") or "-",
            _ts_to_str(last.get("timestamp")),
            _duration_str(last.get("duration")),
        ])
    return _truncate(_fmt_table(
        ["NAME", "STATUS", "LAST_BUILD", "RESULT", "WHEN", "DURATION"], rows
    ))


def _cmd_list_builds(config):
    """Recent builds across all jobs — walks the top 30 jobs and collects
    their last 3 builds each."""
    tree = "jobs[name,builds[number,result,timestamp,duration,building]{0,3}]{0,30}"
    ok, body = _http_get(config, f"api/json?tree={tree}")
    if not ok:
        return body
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return f"[ERROR] Invalid JSON from Jenkins:\n{body[:200]}"

    rows = []
    for j in data.get("jobs", []):
        name = j.get("name", "-")
        for b in j.get("builds", []):
            rows.append([
                name,
                f"#{b.get('number', '-')}",
                "RUNNING" if b.get("building") else (b.get("result") or "-"),
                _ts_to_str(b.get("timestamp")),
                _duration_str(b.get("duration")),
            ])
    if not rows:
        return "No builds found."
    rows.sort(key=lambda r: r[3], reverse=True)
    return _truncate(_fmt_table(
        ["JOB", "BUILD", "RESULT", "WHEN", "DURATION"], rows[:60]
    ))


def _cmd_list_queue(config):
    ok, body = _http_get(config, "queue/api/json")
    if not ok:
        return body
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return f"[ERROR] Invalid JSON from Jenkins:\n{body[:200]}"

    items = data.get("items", [])
    if not items:
        return "Queue is empty."
    rows = []
    for it in items:
        task = it.get("task") or {}
        rows.append([
            task.get("name", "-"),
            "stuck" if it.get("stuck") else ("blocked" if it.get("blocked") else "waiting"),
            _ts_to_str(it.get("inQueueSince")),
            (it.get("why") or "-")[:60],
        ])
    return _truncate(_fmt_table(["JOB", "STATE", "SINCE", "REASON"], rows))


def _cmd_list_agents(config):
    ok, body = _http_get(config, "computer/api/json?tree=computer[displayName,offline,temporarilyOffline,numExecutors,idle,offlineCauseReason]")
    if not ok:
        return body
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return f"[ERROR] Invalid JSON from Jenkins:\n{body[:200]}"

    agents = data.get("computer", [])
    if not agents:
        return "No agents found."
    rows = []
    for a in agents:
        status = "offline" if a.get("offline") else ("idle" if a.get("idle") else "busy")
        if a.get("temporarilyOffline"):
            status = "temp-offline"
        rows.append([
            a.get("displayName", "-"),
            status,
            a.get("numExecutors", "-"),
            (a.get("offlineCauseReason") or "-")[:60],
        ])
    return _truncate(_fmt_table(["NAME", "STATUS", "EXECUTORS", "REASON"], rows))


_HANDLERS = {
    "test":           _cmd_test,
    "list_jobs":      _cmd_list_jobs,
    "list_pipelines": lambda cfg: _cmd_list_jobs(cfg, pipelines_only=True),
    "list_builds":    _cmd_list_builds,
    "list_queue":     _cmd_list_queue,
    "list_agents":    _cmd_list_agents,
}


def run_jenkins(config, command):
    """Entry point used by ToolExecutor. `command` is a pseudo-command
    keyword (see _HANDLERS). Unknown commands return an error string."""
    cmd = (command or "").strip()
    handler = _HANDLERS.get(cmd)
    if not handler:
        return f"[ERROR] Unknown Jenkins command: {cmd!r}. Supported: {', '.join(sorted(_HANDLERS))}"
    return handler(config)
