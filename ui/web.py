"""
ui/web.py — Flask web server for Aziro Ops.

Routes only — all logic lives in agent/, providers/, tools/, sessions/, targets/.
Mirrors the thin route-handler pattern from kubectl-ai's cmd/main.go.

Entry point: run via app.py (at project root)
"""
import re
import json
import uuid
import socket
import platform
import queue as _queue
import threading
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, request, jsonify, send_from_directory, Response

from providers import LLMClient
from tools     import ToolExecutor
from sessions  import SessionManager
from targets   import TargetManager
from agent     import needs_tools, AgentSession, Agent
from monitor   import EventWatcher, Triage
from store     import EventStore

# ── singletons ───────────────────────────────────────────────────────────────
# One instance of each class for the lifetime of the web server.
# Mirrors kubectl-ai's top-level struct fields in cmd/main.go.

_llm      = LLMClient()
_tools    = ToolExecutor()
_sessions = SessionManager()
_targets  = TargetManager()
_agent    = Agent(_llm, _tools)
_session  = AgentSession()
_store    = EventStore()

_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend_dist")
app = Flask(__name__, static_folder=None)

MAX_HISTORY = 20

# ── helpers ───────────────────────────────────────────────────────────────────

def _trim(messages):
    system  = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]
    return system + history[-MAX_HISTORY:]


_CMD_TIMEOUT = 30  # seconds per command

def _run_many(target, cmds):
    """Run multiple commands in parallel on a target, with per-command timeout."""
    if len(cmds) <= 1:
        return {k: _tools.execute(target, v) for k, v in cmds.items()}
    results = {}
    with ThreadPoolExecutor(max_workers=min(len(cmds), 8)) as pool:
        futures = {pool.submit(_tools.execute, target, cmd): key
                   for key, cmd in cmds.items()}
        for future in as_completed(futures, timeout=_CMD_TIMEOUT * len(cmds)):
            key = futures[future]
            try:
                results[key] = future.result(timeout=_CMD_TIMEOUT)
            except Exception as e:
                results[key] = f"[TIMEOUT or ERROR] {e}"
    return results


# ── server info ──────────────────────────────────────────────────────────────

@app.route("/api/info", methods=["GET"])
def api_info():
    return jsonify({
        "tool_model":   _llm.tool_model,
        "answer_model": _llm.answer_model,
    })


# ── static ────────────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path: str):
    """Serve React SPA for all non-API routes."""
    # Let Flask serve static assets (JS/CSS chunks) directly
    full = os.path.join(_DIST, path)
    if path and os.path.isfile(full):
        return send_from_directory(_DIST, path)
    # All other routes → index.html (React Router handles client-side routing)
    return send_from_directory(_DIST, "index.html")


# ── targets ───────────────────────────────────────────────────────────────────

@app.route("/api/targets", methods=["GET"])
def api_list():
    return jsonify(_targets.load_safe())


@app.route("/api/targets", methods=["POST"])
def api_add():
    d = request.json or {}
    name = (d.get("name") or "").strip()
    ttype = (d.get("type") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    valid_types = {"ssh", "kubernetes", "docker", "aws", "gcp", "azure", "terraform", "local"}
    if ttype not in valid_types:
        return jsonify({"error": f"invalid type: {ttype}"}), 400
    return jsonify(_targets.add(name, ttype, d.get("config", {})))


@app.route("/api/targets/<tid>", methods=["DELETE"])
def api_delete(tid):
    _targets.remove(tid)
    _session.remove(tid)
    return jsonify({"ok": True})


_TEST_COMMANDS = {
    "kubernetes": "kubectl cluster-info 2>&1 | head -5",
    "docker":     "docker info --format '{{.ServerVersion}}' 2>&1",
    "aws":        "aws sts get-caller-identity 2>&1",
    "gcp":        "gcloud config get-value project 2>&1",
    "azure":      "az account show --query name -o tsv 2>&1",
    "terraform":  "terraform version 2>&1 | head -2",
}

@app.route("/api/targets/<tid>/test", methods=["GET"])
def api_test(tid):
    target = _targets.get(tid)
    if not target:
        return jsonify({"status": "error", "message": "Target not found"}), 404
    ttype = target.get("type", "ssh")
    cmd   = _TEST_COMMANDS.get(ttype, "echo OK && uname -a && uptime")
    out   = _tools.execute(target, cmd)
    # treat empty output or known error markers as offline
    failed = not out.strip() or any(e in out for e in ["SSH ERROR", "ERROR:", "error:", "command not found", "No such file"])
    # kubernetes: must see "Kubernetes control plane" to be truly online
    if ttype == "kubernetes":
        failed = "control plane" not in out.lower() and "kubernetes" not in out.lower()
    status = "offline" if failed else "online"
    _targets.update_status(tid, status)
    return jsonify({"status": status, "message": out})


# ── tab commands (dashboard quick-view panels) ────────────────────────────────

TAB_COMMANDS = {
    "ssh": {
        "overview":   {"uptime": "uptime", "memory": "free -m", "disk": "df -h /",
                       "cpu": "top -bn1 | grep '%Cpu'",
                       "os": "cat /etc/os-release | grep PRETTY_NAME",
                       "failed_svc": "systemctl list-units --failed --no-legend 2>/dev/null",
                       "top_procs": "ps aux --sort=-%cpu | head -6",
                       "hostname": "hostname -f 2>/dev/null || hostname"},
        "kubernetes": {"nodes": "kubectl get nodes -o wide",
                       "pods": "kubectl get pods -A -o wide",
                       "deployments": "kubectl get deployments -A",
                       "services": "kubectl get svc -A",
                       "events": "kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -20"},
        "logs":       {"logs": "journalctl -n 100 --no-pager 2>/dev/null"},
        "network":    {"ports": "ss -tlnp", "routes": "ip route show",
                       "dns": "cat /etc/resolv.conf",
                       "interfaces": "ip -brief addr show"},
        "storage":    {"filesystems": "df -h",
                       "top_dirs": "du -sh /* 2>/dev/null | sort -rh | head -15",
                       "inodes": "df -i"},
    },
    "kubernetes": {
        "nodes":       {"output": "kubectl get nodes -o wide"},
        "pods":        {"pods": "kubectl get pods -A -o wide"},
        "workloads":   {"deployments": "kubectl get deployments -A",
                        "replicasets": "kubectl get rs -A 2>/dev/null",
                        "statefulsets": "kubectl get statefulsets -A 2>/dev/null",
                        "daemonsets": "kubectl get daemonsets -A 2>/dev/null",
                        "jobs": "kubectl get jobs -A 2>/dev/null",
                        "cronjobs": "kubectl get cronjobs -A 2>/dev/null"},
        "services":    {"services": "kubectl get svc -A"},
        "ingress":     {"ingresses": "kubectl get ingress -A 2>/dev/null",
                        "ingressclasses": "kubectl get ingressclass 2>/dev/null"},
        "k8s_storage": {"pvcs": "kubectl get pvc -A 2>/dev/null",
                        "pvs": "kubectl get pv 2>/dev/null",
                        "storageclasses": "kubectl get storageclass 2>/dev/null"},
        "network":     {"services": "kubectl get svc -A",
                        "ingresses": "kubectl get ingress -A 2>/dev/null",
                        "netpolicies": "kubectl get networkpolicy -A 2>/dev/null",
                        "endpoints": "kubectl get endpoints -A 2>/dev/null | head -40"},
        "events":      {"output": "kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -30"},
    },
    "docker": {
        "containers": {"output": "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"},
        "images":     {"output": "docker images"},
        "networks":   {"output": "docker network ls"},
        "volumes":    {"output": "docker volume ls"},
        "stats":      {"output": "docker stats --no-stream"},
    },
    "aws": {
        "account": {"identity": "aws sts get-caller-identity 2>/dev/null",
                    "quotas": "aws service-quotas list-services --output table 2>/dev/null | head -20"},
        "ec2":     {"output": "aws ec2 describe-instances --query 'Reservations[*].Instances[*].[InstanceId,State.Name,InstanceType,PublicIpAddress,Tags[?Key==`Name`].Value|[0]]' --output table 2>/dev/null"},
        "s3":      {"output": "aws s3 ls 2>/dev/null"},
        "eks":     {"output": "aws eks list-clusters --output table 2>/dev/null"},
        "rds":     {"output": "aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,Engine,DBInstanceClass]' --output table 2>/dev/null"},
    },
    "gcp": {
        "account": {"config": "gcloud config list 2>/dev/null",
                    "projects": "gcloud projects list 2>/dev/null | head -20"},
        "compute": {"output": "gcloud compute instances list 2>/dev/null"},
        "gke":     {"output": "gcloud container clusters list 2>/dev/null"},
        "storage": {"output": "gsutil ls 2>/dev/null"},
        "iam":     {"output": "gcloud projects get-iam-policy $(gcloud config get-value project) 2>/dev/null | head -40"},
    },
    "azure": {
        "account": {"account": "az account show 2>/dev/null",
                    "subscriptions": "az account list --output table 2>/dev/null"},
        "vms":     {"output": "az vm list -d --output table 2>/dev/null"},
        "aks":     {"output": "az aks list --output table 2>/dev/null"},
        "storage": {"output": "az storage account list --output table 2>/dev/null"},
        "groups":  {"output": "az group list --output table 2>/dev/null"},
    },
    "terraform": {
        "state":   {"resources": "terraform state list 2>/dev/null",
                    "workspace": "terraform workspace show 2>/dev/null"},
        "plan":    {"output": "terraform plan -no-color 2>/dev/null | tail -60"},
        "outputs": {"output": "terraform output 2>/dev/null"},
    },
}
TAB_COMMANDS["local"] = TAB_COMMANDS["ssh"]

if platform.system() == "Windows":
    TAB_COMMANDS["local"] = {
        "overview": {
            "uptime":     'powershell -Command "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime"',
            "memory":     'powershell -Command "$m=Get-CimInstance Win32_OperatingSystem; $t=[math]::Round($m.TotalVisibleMemorySize/1024); $f=[math]::Round($m.FreePhysicalMemory/1024); $u=$t-$f; Write-Output \\"Mem: $t $u $f\\""',
            "disk":       'powershell -Command "Get-PSDrive C | ForEach-Object { $u=[math]::Round($_.Used/1GB,1); $f=[math]::Round($_.Free/1GB,1); $t=$u+$f; $p=[math]::Round($u/$t*100); Write-Output \\"C: ${t}G ${u}G ${f}G ${p}%\\" }"',
            "cpu":        'powershell -Command "$c=(Get-CimInstance Win32_Processor).LoadPercentage; Write-Output \\"${c}% us\\""',
            "os":         'powershell -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
            "failed_svc": 'powershell -Command "Get-Service | Where-Object {$_.Status -eq \\"Stopped\\" -and $_.StartType -eq \\"Automatic\\"} | Select-Object -First 5 -ExpandProperty Name"',
            "top_procs":  'powershell -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 6 | Format-Table -AutoSize Name, Id, CPU, WorkingSet"',
            "hostname":   "hostname",
        },
        "network": {
            "ports":      'powershell -Command "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize"',
            "routes":     "route print",
            "dns":        'powershell -Command "Get-DnsClientServerAddress | Format-Table -AutoSize"',
            "interfaces": 'powershell -Command "Get-NetIPAddress | Select-Object InterfaceAlias,IPAddress,PrefixLength | Format-Table -AutoSize"',
        },
        "storage": {
            "filesystems": 'powershell -Command "Get-PSDrive -PSProvider FileSystem | Format-Table Name,Used,Free -AutoSize"',
            "top_dirs":    'powershell -Command "Get-ChildItem C:\\ -Directory -ErrorAction SilentlyContinue | ForEach-Object { $s=(Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; [PSCustomObject]@{Name=$_.Name; SizeGB=[math]::Round($s/1GB,2)} } | Sort-Object SizeGB -Descending | Select-Object -First 10 | Format-Table -AutoSize"',
            "inodes":      'powershell -Command "Get-PSDrive -PSProvider FileSystem | Format-Table Name,Used,Free -AutoSize"',
        },
    }


def _auto_register_localhost():
    if _targets.has_local():
        return
    t = _targets.add(f"This Server ({socket.gethostname()})", "local", {})
    _targets.update_status(t["id"], "online")
    print(f"  Auto-registered local target: {socket.gethostname()}")

_auto_register_localhost()


# ── kubernetes resource detail ────────────────────────────────────────────────

_SAFE_KINDS   = {
    "pod", "node", "deployment", "service", "ingress", "replicaset",
    "statefulset", "daemonset", "configmap", "namespace", "event",
    "persistentvolumeclaim", "persistentvolume", "job", "cronjob",
}
_SAFE_NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9.\-]*$')


@app.route("/api/resource/<tid>", methods=["GET"])
def api_resource(tid):
    target = _targets.get(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    kind = request.args.get("kind", "pod").lower()
    name = request.args.get("name", "").strip()
    ns   = request.args.get("ns", "").strip()

    if kind not in _SAFE_KINDS:                   return jsonify({"error": "invalid kind"}), 400
    if not name or not _SAFE_NAME_RE.match(name): return jsonify({"error": "invalid name"}), 400
    if ns and not _SAFE_NAME_RE.match(ns):        return jsonify({"error": "invalid namespace"}), 400

    ns_flag = f" -n {ns}" if ns else ""
    if kind == "pod":
        result = _run_many(target, {
            "describe": f"kubectl describe pod {name}{ns_flag} 2>&1",
            "logs":     f"kubectl logs {name}{ns_flag} --tail=150 2>&1",
            "previous": f"kubectl logs {name}{ns_flag} --previous --tail=50 2>&1 || echo '[no previous container]'",
        })
    else:
        result = {"describe": _tools.execute(target, f"kubectl describe {kind} {name}{ns_flag} 2>&1")}

    return jsonify(result)


@app.route("/api/tab/<tid>/<tab>")
def api_tab(tid, tab):
    target = _targets.get(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    ttype = target.get("type", "ssh")
    cmds  = TAB_COMMANDS.get(ttype, {}).get(tab)
    if not cmds:
        return jsonify({"error": f"No data for {ttype}/{tab}"}), 404

    if ttype == "ssh" and tab == "logs":
        unit  = request.args.get("unit", "")
        lines = request.args.get("lines", "100")
        cmd   = (f"journalctl -u {unit} -n {lines} --no-pager 2>/dev/null"
                 if unit else f"journalctl -n {lines} --no-pager 2>/dev/null")
        return jsonify({"logs": _tools.execute(target, cmd)})

    return jsonify(_run_many(target, cmds))


# ── AI chat — target-specific streaming ──────────────────────────────────────

@app.route("/api/chat/<tid>/stream", methods=["POST"])
def api_chat_stream(tid):
    target = _targets.get(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    user_msg = request.json.get("message", "").strip()
    if not user_msg:
        return jsonify({"error": "empty message"}), 400

    messages = _session.get(tid)
    messages.append({"role": "user", "content": user_msg})
    messages = _trim(messages)
    _session.set(tid, messages)

    def generate():
        try:
            if not needs_tools(user_msg):
                full = ""
                for chunk in _llm.chat_stream(messages, use_tools=False):
                    full += chunk
                    yield f"data: {json.dumps({'t': chunk})}\n\n"
                messages.append({"role": "assistant", "content": full})
                _session.set(tid, messages)
                yield "data: [DONE]\n\n"
            else:
                yield from _agent.run(messages, target, _session, tid)
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── AI analysis ───────────────────────────────────────────────────────────────

_ANALYSIS_SYSTEM = (
    "You are a Kubernetes and DevOps expert. "
    "Analyze the provided data and give clear, actionable recommendations. "
    "Use markdown formatting."
)


@app.route("/api/analyze/stream", methods=["POST"])
def api_analyze_stream():
    prompt = request.json.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "empty prompt"}), 400
    messages = [{"role": "system", "content": _ANALYSIS_SYSTEM},
                {"role": "user",   "content": prompt}]
    return Response(_agent.stream(messages), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    prompt = request.json.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "empty prompt"}), 400
    messages = [{"role": "system", "content": _ANALYSIS_SYSTEM},
                {"role": "user",   "content": prompt}]
    try:
        reply, _, _ = _llm.chat(messages, use_tools=False)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Event monitoring ──────────────────────────────────────────────────────────
# One watcher per server — browsers subscribe via SSE.
# Each browser tab gets its own queue via /api/monitor/stream.

_monitor_subs  = {}          # sub_id → queue.Queue
_monitor_lock  = threading.Lock()
_web_watcher   = None        # EventWatcher | None


def _broadcast_alert(event):
    """Push a monitor alert to every active SSE subscriber."""
    dead = []
    for sid, q in list(_monitor_subs.items()):
        try:
            q.put_nowait(event)
        except Exception:
            dead.append(sid)
    for sid in dead:
        _monitor_subs.pop(sid, None)


def _web_classify(raw_event):
    from monitor.triage import _SEV1_REASONS, _SEV2_REASONS
    r = raw_event.get("reason", "")
    if r in _SEV1_REASONS: return "SEV1"
    if r in _SEV2_REASONS: return "SEV2"
    return "SEV3"


def _web_triage_handle(raw_event):
    """
    Lightweight triage for the web — classify and broadcast to SSE subscribers.
    No auto-queries: user investigates via the chat UI after seeing the alert.
    """
    if raw_event.get("type") == "Normal":
        return

    level = _web_classify(raw_event)
    _broadcast_alert({
        "type":      "monitor_alert",
        "level":     level,
        "reason":    raw_event.get("reason", ""),
        "object":    raw_event.get("object", ""),
        "namespace": raw_event.get("namespace", ""),
        "message":   raw_event.get("message", ""),
        "source":    raw_event.get("source", "kubernetes"),
    })


@app.route("/api/monitor/start/<tid>", methods=["POST"])
def api_monitor_start(tid):
    """Start monitoring a target. Broadcasts alerts to all /api/monitor/stream subscribers."""
    global _web_watcher
    target = _targets.get(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    executor = lambda cmd: _tools.execute(target, cmd)

    with _monitor_lock:
        if _web_watcher:
            _web_watcher.stop()
        _web_watcher = EventWatcher(executor)
        _web_watcher.on_event(_web_triage_handle)
        # only persist Warning events — Normal events are informational noise
        _web_watcher.on_event(lambda e: _store.save_event(e, _web_classify(e)) if e.get("type") == "Warning" else None)
        _web_watcher.watch()

    return jsonify({"ok": True, "monitoring": tid})


@app.route("/api/monitor/stop", methods=["POST"])
def api_monitor_stop():
    """Stop the active watcher."""
    global _web_watcher
    with _monitor_lock:
        if _web_watcher:
            _web_watcher.stop()
            _web_watcher = None
    return jsonify({"ok": True})


@app.route("/api/monitor/status", methods=["GET"])
def api_monitor_status():
    return jsonify({"active": _web_watcher is not None})


@app.route("/api/monitor/stream")
def api_monitor_stream():
    """
    SSE endpoint — each browser tab subscribes here to receive live alerts.
    Sends keepalive every 25 s to prevent connection timeout.
    """
    sub_id = str(uuid.uuid4())
    sub_q  = _queue.Queue()
    _monitor_subs[sub_id] = sub_q

    def generate():
        try:
            while True:
                try:
                    event = sub_q.get(timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except _queue.Empty:
                    yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
        finally:
            _monitor_subs.pop(sub_id, None)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── general chat sessions ─────────────────────────────────────────────────────

@app.route("/api/sessions", methods=["GET"])
def api_sessions_list():
    return jsonify(_sessions.load())


@app.route("/api/sessions", methods=["POST"])
def api_sessions_create():
    return jsonify(_sessions.create(request.json.get("title", "New Chat")))


@app.route("/api/sessions/<sid>", methods=["DELETE"])
def api_sessions_delete(sid):
    _sessions.delete(sid)
    return jsonify({"ok": True})


@app.route("/api/sessions/<sid>/messages", methods=["GET"])
def api_sessions_messages(sid):
    msgs = _sessions.get_messages(sid)
    return jsonify([m for m in msgs if m["role"] != "system"])


@app.route("/api/sessions/<sid>/chat/stream", methods=["POST"])
def api_sessions_chat_stream(sid):
    user_msg = request.json.get("message", "").strip()
    if not user_msg:
        return jsonify({"error": "empty message"}), 400

    msgs = _sessions.get_messages(sid)
    msgs.append({"role": "user", "content": user_msg})
    msgs[:] = _trim(msgs)
    _sessions.update_title(sid, user_msg)

    def generate():
        full = ""
        for chunk in _llm.chat_stream(msgs, use_tools=False):
            full += chunk
            yield f"data: {json.dumps({'t': chunk})}\n\n"
        msgs.append({"role": "assistant", "content": full})
        _sessions.set_messages(sid, msgs)
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Event history API ─────────────────────────────────────────────────────────

@app.route("/api/events", methods=["GET"])
def api_events():
    """List events. Filter: ?level=SEV1  ?object=nginx  ?limit=50"""
    return jsonify(_store.get_events(
        limit       = int(request.args.get("limit", 50)),
        level       = request.args.get("level"),
        object_name = request.args.get("object"),
    ))


@app.route("/api/events/<int:event_id>", methods=["GET"])
def api_event_detail(event_id):
    """One event with its snapshots + AI analyses."""
    event = _store.get_event(event_id)
    if not event:
        return jsonify({"error": "not found"}), 404
    return jsonify(event)


@app.route("/api/events/<int:event_id>", methods=["PATCH"])
def api_event_update(event_id):
    """Update event status: open | acknowledged | resolved"""
    status = (request.json or {}).get("status", "").strip()
    if not _store.update_event_status(event_id, status):
        return jsonify({"error": "invalid status"}), 400
    return jsonify({"ok": True})


@app.route("/api/events/object/<path:name>", methods=["GET"])
def api_events_by_object(name):
    """Full incident history for one pod or node."""
    return jsonify(_store.get_object_history(
        name, limit=int(request.args.get("limit", 20))
    ))


@app.route("/api/stats", methods=["GET"])
def api_stats():
    """Cluster incident stats: counts by level, top failing objects."""
    return jsonify(_store.get_stats())


# ── Topology API ──────────────────────────────────────────────────────────────

@app.route("/api/topology/<tid>", methods=["GET"])
def api_topology(tid):
    """
    Return structured K8s resource graph for a namespace.
    ?namespace=default  (default: all namespaces, top 5)
    """
    target = _targets.get(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    ns = request.args.get("namespace", "").strip()
    ns_flag = f"-n {ns}" if ns and _SAFE_NAME_RE.match(ns) else "-A"

    try:
        cmds = {
            "deployments":  f"kubectl get deployments {ns_flag} --no-headers 2>/dev/null",
            "replicasets":  f"kubectl get replicasets {ns_flag} --no-headers 2>/dev/null",
            "pods":         f"kubectl get pods {ns_flag} --no-headers 2>/dev/null",
            "services":     f"kubectl get services {ns_flag} --no-headers 2>/dev/null",
            "ingresses":    f"kubectl get ingresses {ns_flag} --no-headers 2>/dev/null",
        }
        raw = _run_many(target, cmds)

        def parse_table(text, cols):
            rows = []
            for line in (text or "").strip().split("\n"):
                parts = line.split()
                if len(parts) >= cols:
                    rows.append(parts)
            return rows

        # Parse deployments: NS NAME READY UP-TO-DATE AVAILABLE AGE
        deps = []
        for r in parse_table(raw.get("deployments", ""), 4):
            deps.append({"namespace": r[0], "name": r[1], "ready": r[2], "available": r[3]})

        # Parse pods: NS NAME READY STATUS RESTARTS AGE
        pods = []
        for r in parse_table(raw.get("pods", ""), 5):
            pods.append({"namespace": r[0], "name": r[1], "ready": r[2], "status": r[3], "restarts": r[4]})

        # Parse services: NS NAME TYPE CLUSTER-IP EXTERNAL-IP PORT AGE
        svcs = []
        for r in parse_table(raw.get("services", ""), 4):
            svcs.append({"namespace": r[0], "name": r[1], "type": r[2], "port": r[5] if len(r) > 5 else ""})

        # Parse ingresses: NS NAME CLASS HOSTS ADDR PORT AGE
        ings = []
        for r in parse_table(raw.get("ingresses", ""), 4):
            ings.append({"namespace": r[0], "name": r[1], "hosts": r[3] if len(r) > 3 else ""})

        return jsonify({
            "deployments": deps[:30],
            "pods":        pods[:60],
            "services":    svcs[:30],
            "ingresses":   ings[:20],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Live log streaming ────────────────────────────────────────────────────────

_SAFE_POD_RE = re.compile(r'^[a-z0-9][a-z0-9.\-]*$', re.IGNORECASE)

@app.route("/api/logs/<tid>/stream")
def api_logs_stream(tid):
    """
    SSE stream of kubectl logs -f for a pod.
    ?pod=name  &namespace=default  &container=main
    """
    target = _targets.get(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    pod       = request.args.get("pod", "").strip()
    ns        = request.args.get("namespace", "default").strip()
    container = request.args.get("container", "").strip()

    if not pod or not _SAFE_POD_RE.match(pod):
        return jsonify({"error": "invalid pod name"}), 400
    if ns and not _SAFE_NAME_RE.match(ns):
        return jsonify({"error": "invalid namespace"}), 400

    ns_flag = f"-n {ns}" if ns else ""
    c_flag  = f"-c {container}" if container and _SAFE_NAME_RE.match(container) else ""
    cmd     = f"kubectl logs -f --tail=100 {pod} {ns_flag} {c_flag} 2>&1"

    def generate():
        try:
            import subprocess
            proc = subprocess.Popen(
                cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
            )
            for line in proc.stdout:
                yield f"data: {json.dumps({'line': line.rstrip()})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Search / Cmd+K API ────────────────────────────────────────────────────────

@app.route("/api/search/<tid>")
def api_search(tid):
    """
    Quick search for Cmd+K palette.
    ?q=nginx  Returns pods, deployments, nodes matching the query.
    """
    target = _targets.get(tid)
    if not target:
        return jsonify({"results": []})

    q = request.args.get("q", "").strip().lower()
    if not q or len(q) < 2:
        return jsonify({"results": []})

    try:
        raw = _run_many(target, {
            "pods":  f"kubectl get pods -A --no-headers 2>/dev/null | grep -i {q} | head -10",
            "nodes": f"kubectl get nodes --no-headers 2>/dev/null | grep -i {q} | head -5",
            "deps":  f"kubectl get deployments -A --no-headers 2>/dev/null | grep -i {q} | head -5",
        })
        results = []
        for line in (raw.get("pods") or "").strip().split("\n"):
            parts = line.split()
            if len(parts) >= 4:
                results.append({"kind": "pod", "namespace": parts[0], "name": parts[1], "status": parts[3]})
        for line in (raw.get("nodes") or "").strip().split("\n"):
            parts = line.split()
            if len(parts) >= 2:
                results.append({"kind": "node", "namespace": "", "name": parts[0], "status": parts[1]})
        for line in (raw.get("deps") or "").strip().split("\n"):
            parts = line.split()
            if len(parts) >= 4:
                results.append({"kind": "deployment", "namespace": parts[0], "name": parts[1], "status": parts[2]})
        return jsonify({"results": results[:20]})
    except Exception:
        return jsonify({"results": []})
