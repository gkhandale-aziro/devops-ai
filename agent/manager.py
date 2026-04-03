"""
agent/manager.py — per-target session state (message history for each connection).
"""
from targets  import TargetManager
from prompts  import SYSTEM

MAX_HISTORY = 20

_targets = TargetManager()


def _trim(messages):
    system  = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]
    return system + history[-MAX_HISTORY:]


class AgentSession:
    """Holds conversation state for a single target connection."""

    def __init__(self):
        self._sessions = {}  # target_id → messages list

    def get(self, target_id):
        if target_id not in self._sessions:
            target = _targets.get(target_id)
            name   = target["name"] if target else "server"
            ttype  = target.get("type", "ssh") if target else "ssh"
            self._sessions[target_id] = [
                {"role": "system",
                 "content": SYSTEM + f"\n\nYou are connected to: {name} (type: {ttype})"}
            ]
        return self._sessions[target_id]

    def set(self, target_id, messages):
        self._sessions[target_id] = messages

    def trim(self, messages):
        return _trim(messages)

    def remove(self, target_id):
        self._sessions.pop(target_id, None)
