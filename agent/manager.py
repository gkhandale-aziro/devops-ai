"""
agent/manager.py — per-target session state (message history for each connection).
"""
import threading

from targets  import TargetManager
from prompts  import SYSTEM

MAX_HISTORY = 20

_targets = TargetManager()


def _trim(messages):
    system  = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]
    return system + history[-MAX_HISTORY:]


class AgentSession:
    """Holds conversation state for a single target connection.

    All dict mutations are guarded by an RLock so concurrent Flask workers
    cannot race on `_sessions` (create-vs-remove, concurrent get init, etc).
    Per-target chat serialization is still handled at the call site via
    `_get_session_lock(tid)` in ui/web.py — this lock only protects the
    outer dict, not the message-list semantics.
    """

    def __init__(self):
        self._sessions = {}  # target_id → messages list
        self._lock = threading.RLock()

    def get(self, target_id):
        with self._lock:
            if target_id in self._sessions:
                return self._sessions[target_id]

            target = _targets.get(target_id)
            name   = target["name"] if target else "server"
            ttype  = target.get("type", "ssh") if target else "ssh"
            config = target.get("config", {}) if target else {}

            context_parts = [f"You are connected to: {name} (type: {ttype})"]

            # Add Kubernetes provider specifics so the AI knows the cluster environment
            if ttype == "kubernetes":
                provider = config.get("provider", "local")
                context_parts.append(f"Kubernetes provider: {provider}")
                if config.get("cluster"):
                    context_parts.append(f"Cluster: {config['cluster']}")
                if config.get("region"):
                    context_parts.append(f"Region: {config['region']}")
                if config.get("zone"):
                    context_parts.append(f"Zone: {config['zone']}")
                if config.get("project"):
                    context_parts.append(f"GCP project: {config['project']}")
                if config.get("resource_group"):
                    context_parts.append(f"Azure resource group: {config['resource_group']}")
                if config.get("context"):
                    context_parts.append(f"Kubectl context: {config['context']}")

            self._sessions[target_id] = [
                {"role": "system",
                 "content": SYSTEM + "\n\n" + "\n".join(context_parts)}
            ]
            return self._sessions[target_id]

    def set(self, target_id, messages):
        with self._lock:
            self._sessions[target_id] = messages

    def trim(self, messages):
        return _trim(messages)

    def remove(self, target_id):
        with self._lock:
            self._sessions.pop(target_id, None)
