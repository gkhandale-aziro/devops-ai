"""
agent/manager.py — per-target session state (message history for each connection).
"""
import threading
import time
from collections import OrderedDict

from targets  import TargetManager
from prompts  import SYSTEM

MAX_HISTORY = 20

# LRU + TTL bounds for AgentSession._sessions. A long-running Flask deployment
# managing many targets would otherwise accumulate one entry per target_id
# forever (H-06 in the gap analysis). Eviction runs on every read/write.
MAX_CACHED_SESSIONS = 64
SESSION_TTL_SEC     = 3600   # 1h idle → evicted

_targets = TargetManager()


def _trim(messages):
    system  = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]
    return system + history[-MAX_HISTORY:]


class AgentSession:
    """Holds conversation state for a single target connection.

    Eviction (H-06)
    ---------------
    `_sessions` is an OrderedDict of target_id → (messages, last_access_ts).
    On every access we drop entries older than SESSION_TTL_SEC and cap the
    dict at MAX_CACHED_SESSIONS (oldest-first). The underlying message list
    is still persisted via the target's chat history — eviction only clears
    the in-memory cache, so a re-fetched target just rebuilds from DB.

    All dict mutations are guarded by an RLock so concurrent Flask workers
    cannot race on `_sessions` (create-vs-remove, concurrent get init, etc).
    Per-target chat serialization is still handled at the call site via
    `_get_session_lock(tid)` in ui/web.py — this lock only protects the
    outer dict, not the message-list semantics.
    """

    def __init__(self):
        # OrderedDict so move_to_end() gives us cheap LRU reordering.
        self._sessions: OrderedDict = OrderedDict()  # target_id → (messages, ts)
        self._lock = threading.RLock()

    def _evict(self):
        """Drop TTL-expired entries, then cap the dict size. Must be called
        under self._lock."""
        now = time.time()
        expired = [tid for tid, (_, ts) in self._sessions.items()
                   if now - ts > SESSION_TTL_SEC]
        for tid in expired:
            self._sessions.pop(tid, None)
        while len(self._sessions) > MAX_CACHED_SESSIONS:
            # popitem(last=False) removes the oldest (least-recently-used).
            self._sessions.popitem(last=False)

    def get(self, target_id):
        with self._lock:
            now = time.time()
            # Drop TTL-expired entries first (cheap and keeps the dict honest
            # about what a "cache hit" means). Size-cap eviction runs after
            # the insert below so we never overflow before trimming.
            expired = [tid for tid, (_, ts) in self._sessions.items()
                       if now - ts > SESSION_TTL_SEC]
            for tid in expired:
                self._sessions.pop(tid, None)

            if target_id in self._sessions:
                messages, _ = self._sessions[target_id]
                # Refresh LRU position + access timestamp.
                self._sessions[target_id] = (messages, now)
                self._sessions.move_to_end(target_id)
                return messages

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

            messages = [
                {"role": "system",
                 "content": SYSTEM + "\n\n" + "\n".join(context_parts)}
            ]
            self._sessions[target_id] = (messages, now)
            # Cap size after insert so the dict never exceeds the limit.
            while len(self._sessions) > MAX_CACHED_SESSIONS:
                self._sessions.popitem(last=False)  # drop oldest (LRU)
            return messages

    def set(self, target_id, messages):
        with self._lock:
            self._sessions[target_id] = (messages, time.time())
            self._sessions.move_to_end(target_id)
            self._evict()

    def trim(self, messages):
        return _trim(messages)

    def remove(self, target_id):
        with self._lock:
            self._sessions.pop(target_id, None)
