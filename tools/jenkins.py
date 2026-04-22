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


# ── JSON-producing variants (rich dashboard UI) ──────────────────────────────
#
# Same Jenkins endpoints as above but each returns a JSON-encoded structured
# payload instead of a formatted text table. Consumed by the frontend's
# Jenkins tab components via JSON.parse. Keeping the two families separate
# means the AI-chat flow (which wants pretty text) still sees tables, while
# the dashboard tabs get typed data.


def _cmd_overview_json(config):
    """Aggregate KPIs + 24h build-result buckets for the Overview tab."""
    out = {
        "jobs_total": 0, "success_rate": 0, "running": 0,
        "queue_len":  0, "nodes_online": 0, "nodes_total": 0,
        "mode": "", "url": (config.get("url", "") or "").strip().rstrip("/"),
        "activity_24h": [],
    }

    # Root: jobs + controller mode
    ok, body = _http_get(
        config,
        "api/json?tree=jobs[name,color,builds[result,timestamp,duration]{0,8}],mode",
    )
    if ok:
        try:
            data = json.loads(body)
            jobs = data.get("jobs", []) or []
            out["jobs_total"] = len(jobs)
            out["mode"] = data.get("mode", "") or ""

            running = sum(1 for j in jobs if str(j.get("color", "")).endswith("_anime"))
            finished = [(j.get("builds") or [{}])[0] for j in jobs if j.get("builds")]
            successful = sum(1 for b in finished if b and b.get("result") == "SUCCESS")
            out["running"] = running
            out["success_rate"] = round(successful / len(finished) * 100) if finished else 0

            # 24 one-hour buckets ending "now" (UTC)
            import time
            hour_ms = 3_600_000
            now_ms = int(time.time() * 1000)
            start_hour = (now_ms // hour_ms - 23) * hour_ms
            buckets = {start_hour + i * hour_ms: {"hour": start_hour + i * hour_ms,
                                                    "success": 0, "failure": 0, "other": 0}
                       for i in range(24)}
            for j in jobs:
                for b in (j.get("builds") or []):
                    ts = b.get("timestamp") or 0
                    bucket = (ts // hour_ms) * hour_ms
                    if bucket in buckets:
                        r = (b.get("result") or "").upper()
                        if r == "SUCCESS":   buckets[bucket]["success"] += 1
                        elif r == "FAILURE": buckets[bucket]["failure"] += 1
                        else:                buckets[bucket]["other"]   += 1
            out["activity_24h"] = [buckets[k] for k in sorted(buckets)]
        except json.JSONDecodeError:
            out["error"] = "Invalid JSON from Jenkins root endpoint"

    # Queue length
    ok, body = _http_get(config, "queue/api/json?tree=items[id]")
    if ok:
        try:
            out["queue_len"] = len(json.loads(body).get("items", []) or [])
        except json.JSONDecodeError:
            pass

    # Nodes
    ok, body = _http_get(config, "computer/api/json?tree=computer[offline]")
    if ok:
        try:
            computers = json.loads(body).get("computer", []) or []
            out["nodes_total"]  = len(computers)
            out["nodes_online"] = sum(1 for n in computers if not n.get("offline"))
        except json.JSONDecodeError:
            pass

    return json.dumps(out)


def _cmd_list_pipelines_json(config):
    """Structured pipelines list with health score for the rich Pipelines tab."""
    tree = ("jobs[name,fullName,url,color,buildable,_class,"
            "healthReport[score,description],"
            "lastBuild[number,result,timestamp,duration,url]]")
    ok, body = _http_get(config, f"api/json?tree={tree}")
    if not ok:
        return json.dumps({"error": body})
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return json.dumps({"error": "Invalid JSON from Jenkins"})

    rows = []
    for j in data.get("jobs", []) or []:
        color = str(j.get("color", ""))
        building = color.endswith("_anime")
        lb = j.get("lastBuild") or {}
        health = (j.get("healthReport") or [{}])[0]
        rows.append({
            "name":         j.get("name", ""),
            "full_name":    j.get("fullName") or j.get("name", ""),
            "url":          j.get("url", ""),
            "status":       "running" if building else _color_to_status(color.replace("_anime", "")),
            "building":     building,
            "buildable":    bool(j.get("buildable", True)),
            "last_number":  lb.get("number"),
            "last_result":  lb.get("result"),
            "last_timestamp": lb.get("timestamp") or 0,
            "last_duration":  lb.get("duration")  or 0,
            "last_url":     lb.get("url") or "",
            "health_score": health.get("score"),
            "health_desc":  health.get("description", ""),
            "is_pipeline":  "Workflow" in j.get("_class", "") or "pipeline" in j.get("_class", "").lower(),
        })
    return json.dumps({"pipelines": rows})


def _cmd_list_agents_json(config):
    """Structured agents list with executor counts + response time for rich UI."""
    tree = ("computer[displayName,offline,temporarilyOffline,idle,numExecutors,"
            "offlineCauseReason,monitorData[*],"
            "executors[currentExecutable[url]]]")
    ok, body = _http_get(config, f"computer/api/json?tree={tree}")
    if not ok:
        return json.dumps({"error": body})
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return json.dumps({"error": "Invalid JSON from Jenkins"})

    rows = []
    for a in data.get("computer", []) or []:
        execs = a.get("executors") or []
        busy = sum(1 for e in execs if (e.get("currentExecutable") or {}).get("url"))
        mon = a.get("monitorData") or {}
        rt = (mon.get("hudson.node_monitors.ResponseTimeMonitor") or {}).get("average")
        arch = (mon.get("hudson.node_monitors.ArchitectureMonitor") or "") or ""
        rows.append({
            "name":         a.get("displayName", ""),
            "offline":      bool(a.get("offline")),
            "temp_offline": bool(a.get("temporarilyOffline")),
            "idle":         bool(a.get("idle")),
            "executors":    a.get("numExecutors") or len(execs),
            "busy":         busy,
            "reason":       (a.get("offlineCauseReason") or ""),
            "response_ms":  rt,
            "arch":         str(arch) if arch else "",
        })
    return json.dumps({"agents": rows})


def _full_name_to_path(full_name):
    """Jenkins nested folder syntax: 'folder/sub/job' → 'job/folder/job/sub/job/job'.
    Strips empty segments and URL-escapes each component."""
    from urllib.parse import quote
    parts = [p for p in (full_name or "").split("/") if p]
    return "/".join(f"job/{quote(p, safe='')}" for p in parts)


def get_build_details(config, full_name, build_number, log_tail_bytes=20000):
    """Fetch rich build metadata, pipeline stages, and log tail.

    Separate from the _HANDLERS registry because it takes parameters beyond
    `config` — ToolExecutor can't route parameterized calls, so `ui/web.py`
    invokes this directly via a dedicated route.
    """
    import json as _json
    out = {
        "full_name":   full_name,
        "build_number": build_number,
        "meta":        None,
        "stages":      [],
        "log_tail":    "",
        "log_truncated": False,
        "error":       None,
    }
    base_path = _full_name_to_path(full_name)
    if not base_path:
        out["error"] = "Invalid pipeline name"
        return _json.dumps(out)
    build_path = f"{base_path}/{build_number}"

    # 1. Build metadata — causes, parameters, changeSets, duration, result.
    tree = ("number,result,building,timestamp,duration,estimatedDuration,url,description,"
            "actions[causes[shortDescription,userId,userName],"
                   "parameters[name,value]],"
            "changeSets[items[commitId,msg,author[fullName],timestamp]],"
            "culprits[fullName]")
    ok, body = _http_get(config, f"{build_path}/api/json?tree={tree}")
    if not ok:
        out["error"] = body
        return _json.dumps(out)
    try:
        data = _json.loads(body)
    except _json.JSONDecodeError:
        out["error"] = "Invalid JSON from Jenkins build metadata endpoint"
        return _json.dumps(out)

    causes = []
    params = []
    for act in data.get("actions") or []:
        for c in (act.get("causes") or []):
            desc = c.get("shortDescription") or ""
            user = c.get("userName") or c.get("userId") or ""
            causes.append({"description": desc, "user": user})
        for p in (act.get("parameters") or []):
            v = p.get("value")
            if isinstance(v, (dict, list)):
                v = _json.dumps(v)[:200]
            params.append({"name": p.get("name", ""), "value": str(v)[:200] if v is not None else ""})

    commits = []
    for cs in (data.get("changeSets") or []):
        for it in (cs.get("items") or [])[:20]:
            author = (it.get("author") or {}).get("fullName", "")
            commits.append({
                "commit":    (it.get("commitId") or "")[:12],
                "author":    author,
                "message":   (it.get("msg") or "")[:200],
                "timestamp": it.get("timestamp") or 0,
            })

    out["meta"] = {
        "number":     data.get("number"),
        "result":     data.get("result"),
        "building":   bool(data.get("building")),
        "timestamp":  data.get("timestamp") or 0,
        "duration":   data.get("duration") or 0,
        "est_duration": data.get("estimatedDuration") or 0,
        "url":        data.get("url") or "",
        "description": data.get("description") or "",
        "causes":     causes,
        "parameters": params,
        "commits":    commits,
        "culprits":   [c.get("fullName", "") for c in (data.get("culprits") or [])],
    }

    # 2. Stages (pipeline jobs only — plain jobs return 404, that's fine).
    ok_st, body_st = _http_get(config, f"{build_path}/wfapi/describe")
    if ok_st:
        try:
            sd = _json.loads(body_st)
            for st in (sd.get("stages") or []):
                out["stages"].append({
                    "name":      st.get("name", ""),
                    "status":    st.get("status", ""),
                    "duration":  st.get("durationMillis") or 0,
                    "start_ts":  st.get("startTimeMillis") or 0,
                    "error":     (st.get("error") or {}).get("message", "") if st.get("error") else "",
                })
        except _json.JSONDecodeError:
            pass  # not fatal — job may not be a Workflow pipeline

    # 3. Console log tail — grab the last N bytes to stay within sane limits.
    ok_log, body_log = _http_get(config, f"{build_path}/consoleText")
    if ok_log:
        if len(body_log) > log_tail_bytes:
            out["log_tail"] = body_log[-log_tail_bytes:]
            out["log_truncated"] = True
        else:
            out["log_tail"] = body_log
    else:
        out["log_tail"] = body_log  # contains error message

    return _json.dumps(out)


_HANDLERS = {
    "test":                _cmd_test,
    "list_jobs":           _cmd_list_jobs,
    "list_pipelines":      lambda cfg: _cmd_list_jobs(cfg, pipelines_only=True),
    "list_builds":         _cmd_list_builds,
    "list_queue":          _cmd_list_queue,
    "list_agents":         _cmd_list_agents,
    # JSON variants — structured data for rich dashboard tabs
    "overview_json":       _cmd_overview_json,
    "list_pipelines_json": _cmd_list_pipelines_json,
    "list_agents_json":    _cmd_list_agents_json,
}


def run_jenkins(config, command):
    """Entry point used by ToolExecutor. `command` is a pseudo-command
    keyword (see _HANDLERS). Unknown commands return an error string."""
    cmd = (command or "").strip()
    handler = _HANDLERS.get(cmd)
    if not handler:
        return f"[ERROR] Unknown Jenkins command: {cmd!r}. Supported: {', '.join(sorted(_HANDLERS))}"
    return handler(config)
