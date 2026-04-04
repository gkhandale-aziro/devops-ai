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

_BASE = os.path.join(os.path.dirname(__file__), "..")


class SessionManager:
    """
    Manages chat sessions — create, delete, load, save messages.
    Sessions are persisted to chat_sessions.json.
    Messages are persisted to chat_messages.json (keyed by session id).
    """

    def __init__(self):
        self._file     = os.path.join(_BASE, "chat_sessions.json")
        self._msg_file = os.path.join(_BASE, "chat_messages.json")
        self._messages = {}  # in-memory cache: session_id → list of messages

    # ── session persistence ──────────────────────────────────────────────────

    def load(self):
        """Return list of all sessions from disk."""
        if os.path.exists(self._file):
            with open(self._file, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    def _save(self, sessions):
        with open(self._file, "w", encoding="utf-8") as f:
            json.dump(sessions, f, indent=2)

    # ── message persistence ──────────────────────────────────────────────────

    def _load_messages(self):
        """Load all messages from disk into cache."""
        if os.path.exists(self._msg_file):
            try:
                with open(self._msg_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_messages(self, all_msgs):
        with open(self._msg_file, "w", encoding="utf-8") as f:
            json.dump(all_msgs, f, indent=2)

    # ── session lifecycle ────────────────────────────────────────────────────

    def create(self, title="New Chat"):
        """Create a new session and return it."""
        sid      = str(uuid.uuid4())[:8]
        sessions = self.load()
        now      = datetime.datetime.now().isoformat()
        session  = {"id": sid, "title": title, "created": now, "updated": now}
        sessions.insert(0, session)
        sessions = sessions[:MAX_SESSIONS]
        self._save(sessions)

        init_msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
        self._messages[sid] = init_msgs
        all_msgs = self._load_messages()
        all_msgs[sid] = init_msgs
        self._save_messages(all_msgs)
        return session

    def delete(self, sid):
        """Delete a session and its messages by id."""
        sessions = [s for s in self.load() if s["id"] != sid]
        self._save(sessions)
        self._messages.pop(sid, None)
        all_msgs = self._load_messages()
        all_msgs.pop(sid, None)
        self._save_messages(all_msgs)

    # ── message access ───────────────────────────────────────────────────────

    def get_messages(self, sid):
        """Return messages for session, loading from disk if needed."""
        if sid not in self._messages:
            all_msgs = self._load_messages()
            if sid in all_msgs:
                self._messages[sid] = all_msgs[sid]
            else:
                self._messages[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
        return self._messages[sid]

    def set_messages(self, sid, msgs):
        """Update messages in memory and persist to disk."""
        self._messages[sid] = msgs
        all_msgs = self._load_messages()
        all_msgs[sid] = msgs
        self._save_messages(all_msgs)

    def update_title(self, sid, title):
        sessions = self.load()
        for s in sessions:
            if s["id"] == sid and s["title"] == "New Chat":
                s["title"]   = title[:50] + ("..." if len(title) > 50 else "")
                s["updated"] = datetime.datetime.now().isoformat()
                self._save(sessions)
                break
