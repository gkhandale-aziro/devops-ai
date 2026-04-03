"""
sessions/manager.py — general AI chat session persistence (ChatGPT-style).
"""
import os
import json
import uuid
import datetime

SYSTEM_PROMPT = (
    "You are Aziro Ops — a helpful AI assistant for DevOps teams. "
    "Answer questions clearly and concisely. Use markdown formatting. "
    "You can discuss any topic: DevOps, Kubernetes, Docker, cloud, coding, general knowledge, etc."
)

MAX_SESSIONS = 100


class SessionManager:
    """
    Manages chat sessions — create, delete, load, save messages.
    Mirrors kubectl-ai's session handling in pkg/agent/conversation.go.
    """

    def __init__(self):
        self._file     = os.path.join(os.path.dirname(__file__), "..", "chat_sessions.json")
        self._messages = {}  # session_id → list of messages (in-memory)

    # ── persistence ──────────────────────────────────────────────────────────

    def load(self):
        """Return list of all sessions from disk."""
        if os.path.exists(self._file):
            with open(self._file, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    def _save(self, sessions):
        with open(self._file, "w", encoding="utf-8") as f:
            json.dump(sessions, f, indent=2)

    # ── session lifecycle ────────────────────────────────────────────────────

    def create(self, title="New Chat"):
        """Create a new session and return it."""
        sid      = str(uuid.uuid4())[:8]
        sessions = self.load()
        session  = {"id": sid, "title": title, "created": datetime.datetime.now().isoformat()}
        sessions.insert(0, session)
        sessions = sessions[:MAX_SESSIONS]
        self._save(sessions)
        self._messages[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
        return session

    def delete(self, sid):
        """Delete a session by id."""
        sessions = [s for s in self.load() if s["id"] != sid]
        self._save(sessions)
        self._messages.pop(sid, None)

    # ── message access ───────────────────────────────────────────────────────

    def get_messages(self, sid):
        """Return messages for session, initialising if needed."""
        if sid not in self._messages:
            self._messages[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
        return self._messages[sid]

    def set_messages(self, sid, msgs):
        self._messages[sid] = msgs

    def update_title(self, sid, title):
        sessions = self.load()
        for s in sessions:
            if s["id"] == sid and s["title"] == "New Chat":
                s["title"] = title[:50] + ("..." if len(title) > 50 else "")
                self._save(sessions)
                break
