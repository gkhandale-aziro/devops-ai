"""
app.py — Flask entry point for Aziro Ops.
Routes only — all logic lives in agent/, tools/, sessions/, targets/.
Run: python3 app.py
"""
import re
import os
import json
import socket
import platform
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, request, jsonify, send_from_directory, Response

from targets     import load_targets, add_target, remove_target, get_target, update_status, has_local_target
from tools       import execute_on_target
from providers   import chat, chat_stream, TOOL_MODEL, ANSWER_MODEL
from prompts     import SYSTEM
from agent       import needs_tools, AgentSession
from agent.conversation import run_agentic_loop, run_direct_stream
from sessions    import load_sessions, create_session, delete_session, \
                        get_session_messages, set_session_messages, update_session_title

app      = Flask(__name__, static_folder=".")
_session = AgentSession()

MAX_HISTORY = 20


# ── Helpers ───────────────────────────────────────────────────────────────────

def _trim(messages):
    system  = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]
    return system + history[-MAX_HISTORY:]


def _run_many(target, cmds):
    """Run multiple commands in parallel on a target."""
    if len(cmds) <= 1:
        return {k: execute_on_target(target, v) for k, v in cmds.items()}
    results = {}
    with ThreadPoolExecutor(max_workers=min(len(cmds), 8)) as pool:
        futures = {pool.submit(execute_on_target, target, cmd): key for key, cmd in cmds.items()}
        for future in as_completed(futures):
            results[futures[future]] = future.result()
    return results


# ── Static ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "ui-dashboard.html")


# ── Targets ───────────────────────────────────────────────────────────────────

@app.route("/api/targets", methods=["GET"])
def api_list():
    return jsonify(load_targets())


@app.route("/api/targets", methods=["POST"])
def api_add():
    d      = request.json
    target = add_target(d["name"], d["type"], d.get("config", {}))
    return jsonify(target)


@app.route("/api/targets/<tid>", methods=["DELETE"])
def api_delete(tid):
    remove_target(tid)
    _session.remove(tid)
    return jsonify({"ok": True})


@app.route("/api/targets/<tid>/test", methods=["GET"])
def api_test(tid):
    target = get_target(tid)
    if not target:
        return jsonify({"status": "error", "message": "Target not found"}), 404
    out = execute_on_target(target, "echo OK && uname -a && uptime")
    if "SSH ERROR" in out or "ERROR" in out:
        update_status(tid, "offline")
        return jsonify({"status": "offline", "message": out})
    update_status(tid, "online")
    return jsonify({"status": "online", "message": out})


# ── Tab commands ──────────────────────────────────────────────────────────────

TAB_COMMANDS = {
    "ssh": {
        "overview":    {"uptime": "uptime", "memory": "free -m", "disk": "df -h /", "cpu": "top -bn1 | grep '%Cpu'", "os": "cat /etc/os-release | grep PRETTY_NAME", "failed_svc": "systemctl list-units --failed --no-legend 2>/dev/null", "top_procs": "ps aux --sort=-%cpu | head -6", "hostname": "hostname -f 2>/dev/null || hostname"},
        "kubernetes":  {"nodes": "kubectl get nodes -o wide", "pods": "kubectl get pods -A -o wide", "deployments": "kubectl get deployments -A", "services": "kubectl get svc -A", "events": "kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -20"},
        "logs":        {"logs": "journalctl -n 100 --no-pager 2>/dev/null"},
        "network":     {"ports": "ss -tlnp", "routes": "ip route show", "dns": "cat /etc/resolv.conf", "interfaces": "ip -brief addr show"},
        "storage":     {"filesystems": "df -h", "top_dirs": "du -sh /* 2>/dev/null | sort -rh | head -15", "inodes": "df -i"},
    },
    "kubernetes": {
        "nodes":       {"output": "kubectl get nodes -o wide"},
        "pods":        {"pods": "kubectl get pods -A -o wide"},
        "deployments": {"deployments": "kubectl get deployments -A", "replicasets": "kubectl get rs -A 2>/dev/null"},
        "services":    {"services": "kubectl get svc -A", "ingresses": "kubectl get ingress -A 2>/dev/null"},
        "network":     {"services": "kubectl get svc -A", "ingresses": "kubectl get ingress -A 2>/dev/null", "netpolicies": "kubectl get networkpolicy -A 2>/dev/null", "endpoints": "kubectl get endpoints -A 2>/dev/null | head -40"},
        "events":      {"output": "kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -30"},
    },
    "docker": {
        "containers":  {"output": "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"},
        "images":      {"output": "docker images"},
        "networks":    {"output": "docker network ls"},
        "volumes":     {"output": "docker volume ls"},
        "stats":       {"output": "docker stats --no-stream"},
    },
    "aws": {
        "account":     {"identity": "aws sts get-caller-identity 2>/dev/null", "quotas": "aws service-quotas list-services --output table 2>/dev/null | head -20"},
        "ec2":         {"output": "aws ec2 describe-instances --query 'Reservations[*].Instances[*].[InstanceId,State.Name,InstanceType,PublicIpAddress,Tags[?Key==`Name`].Value|[0]]' --output table 2>/dev/null"},
        "s3":          {"output": "aws s3 ls 2>/dev/null"},
        "eks":         {"output": "aws eks list-clusters --output table 2>/dev/null"},
        "rds":         {"output": "aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,Engine,DBInstanceClass]' --output table 2>/dev/null"},
    },
    "gcp": {
        "account":     {"config": "gcloud config list 2>/dev/null", "projects": "gcloud projects list 2>/dev/null | head -20"},
        "compute":     {"output": "gcloud compute instances list 2>/dev/null"},
        "gke":         {"output": "gcloud container clusters list 2>/dev/null"},
        "storage":     {"output": "gsutil ls 2>/dev/null"},
        "iam":         {"output": "gcloud projects get-iam-policy $(gcloud config get-value project) 2>/dev/null | head -40"},
    },
    "azure": {
        "account":     {"account": "az account show 2>/dev/null", "subscriptions": "az account list --output table 2>/dev/null"},
        "vms":         {"output": "az vm list -d --output table 2>/dev/null"},
        "aks":         {"output": "az aks list --output table 2>/dev/null"},
        "storage":     {"output": "az storage account list --output table 2>/dev/null"},
        "groups":      {"output": "az group list --output table 2>/dev/null"},
    },
    "terraform": {
        "state":       {"resources": "terraform state list 2>/dev/null", "workspace": "terraform workspace show 2>/dev/null"},
        "plan":        {"output": "terraform plan -no-color 2>/dev/null | tail -60"},
        "outputs":     {"output": "terraform output 2>/dev/null"},
    },
}
TAB_COMMANDS["local"] = TAB_COMMANDS["ssh"]


def _auto_register_localhost():
    if platform.system() == "Windows":
        return
    if has_local_target():
        return
    hostname = socket.gethostname()
    add_target(f"This Server ({hostname})", "local", {})

_auto_register_localhost()


# ── Kubernetes resource detail ────────────────────────────────────────────────

_SAFE_KINDS   = {"pod","node","deployment","service","ingress","replicaset","statefulset","daemonset","configmap","namespace","event","persistentvolumeclaim","persistentvolume","job","cronjob"}
_SAFE_NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9.\-]*$')


@app.route("/api/resource/<tid>", methods=["GET"])
def api_resource(tid):
    target = get_target(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    kind = request.args.get("kind", "pod").lower()
    name = request.args.get("name", "").strip()
    ns   = request.args.get("ns",   "").strip()

    if kind not in _SAFE_KINDS:                    return jsonify({"error": "invalid kind"}), 400
    if not name or not _SAFE_NAME_RE.match(name):  return jsonify({"error": "invalid name"}), 400
    if ns and not _SAFE_NAME_RE.match(ns):         return jsonify({"error": "invalid namespace"}), 400

    ns_flag = f" -n {ns}" if ns else ""
    if kind == "pod":
        cmds = {
            "describe": f"kubectl describe {kind} {name}{ns_flag} 2>&1",
            "logs":     f"kubectl logs {name}{ns_flag} --tail=150 2>&1",
            "previous": f"kubectl logs {name}{ns_flag} --previous --tail=50 2>&1 || echo '[no previous container]'",
        }
        result = _run_many(target, cmds)
    else:
        result = {"describe": execute_on_target(target, f"kubectl describe {kind} {name}{ns_flag} 2>&1")}

    return jsonify(result)


@app.route("/api/tab/<tid>/<tab>")
def api_tab(tid, tab):
    target = get_target(tid)
    if not target:
        return jsonify({"error": "not found"}), 404

    ttype = target.get("type", "ssh")
    cmds  = TAB_COMMANDS.get(ttype, {}).get(tab)
    if not cmds:
        return jsonify({"error": f"No data for {ttype}/{tab}"}), 404

    if ttype == "ssh" and tab == "logs":
        unit  = request.args.get("unit", "")
        lines = request.args.get("lines", "100")
        cmd   = f"journalctl -u {unit} -n {lines} --no-pager 2>/dev/null" if unit else f"journalctl -n {lines} --no-pager 2>/dev/null"
        return jsonify({"logs": execute_on_target(target, cmd)})

    update_status(tid, "online")
    return jsonify(_run_many(target, cmds))


# ── AI Chat — target-specific (streaming) ────────────────────────────────────

@app.route("/api/chat/<tid>/stream", methods=["POST"])
def api_chat_stream(tid):
    target = get_target(tid)
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
        if not needs_tools(user_msg):
            full = ""
            for chunk in chat_stream(messages, use_tools=False):
                full += chunk
                yield f"data: {json.dumps({'t': chunk})}\n\n"
            messages.append({"role": "assistant", "content": full})
            _session.set(tid, messages)
            yield "data: [DONE]\n\n"
        else:
            yield from run_agentic_loop(messages, target, _session, tid)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── AI Analysis ───────────────────────────────────────────────────────────────

_ANALYSIS_SYSTEM = "You are a Kubernetes and DevOps expert. Analyze the provided data and give clear, actionable recommendations. Use markdown formatting."


@app.route("/api/analyze/stream", methods=["POST"])
def api_analyze_stream():
    prompt = request.json.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "empty prompt"}), 400
    messages = [{"role": "system", "content": _ANALYSIS_SYSTEM}, {"role": "user", "content": prompt}]

    return Response(run_direct_stream(messages), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})



@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    prompt = request.json.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "empty prompt"}), 400
    messages = [{"role": "system", "content": _ANALYSIS_SYSTEM}, {"role": "user", "content": prompt}]
    try:
        reply, _, _ = chat(messages, use_tools=False)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── General Chat Sessions ─────────────────────────────────────────────────────

@app.route("/api/sessions", methods=["GET"])
def api_sessions_list():
    return jsonify(load_sessions())


@app.route("/api/sessions", methods=["POST"])
def api_sessions_create():
    title   = request.json.get("title", "New Chat")
    session = create_session(title)
    return jsonify(session)


@app.route("/api/sessions/<sid>", methods=["DELETE"])
def api_sessions_delete(sid):
    delete_session(sid)
    return jsonify({"ok": True})


@app.route("/api/sessions/<sid>/messages", methods=["GET"])
def api_sessions_messages(sid):
    msgs = get_session_messages(sid)
    return jsonify([m for m in msgs if m["role"] != "system"])


@app.route("/api/sessions/<sid>/chat/stream", methods=["POST"])
def api_sessions_chat_stream(sid):
    user_msg = request.json.get("message", "").strip()
    if not user_msg:
        return jsonify({"error": "empty message"}), 400

    msgs = get_session_messages(sid)
    msgs.append({"role": "user", "content": user_msg})
    msgs[:] = _trim(msgs)
    update_session_title(sid, user_msg)

    def generate():
        full = ""
        for chunk in chat_stream(msgs, use_tools=False):
            full += chunk
            yield f"data: {json.dumps({'t': chunk})}\n\n"
        msgs.append({"role": "assistant", "content": full})
        set_session_messages(sid, msgs)
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Aziro Ops")
    print(f"  Tool model:   {TOOL_MODEL}")
    print(f"  Answer model: {ANSWER_MODEL}")
    print(f"  URL: http://localhost:5000\n")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
