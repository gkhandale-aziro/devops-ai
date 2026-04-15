"""
sessions/manager.py — general AI chat session persistence (ChatGPT-style).
"""
import os
import json
import uuid
import datetime
import threading

SYSTEM_PROMPT = (
    "You are Aziro Ops — a helpful AI assistant for DevOps teams. "
    "Answer questions clearly and concisely. Use markdown formatting. "
    "You can discuss any topic: DevOps, Kubernetes, Docker, cloud, coding, general knowledge, etc."
)

MAX_SESSIONS = 100

_BASE = os.environ.get("AZIRO_DATA_DIR", os.path.join(os.path.dirname(__file__), ".."))


def _atomic_write_json(path, data):
    """Write `data` as JSON to `path` atomically.

    Writes to a sibling .tmp file, flushes + fsyncs, then os.replace()'s
    it onto the target — so a crash mid-write can leave the .tmp behind
    but never corrupts the canonical file. Matches the pattern used by
    targets/manager.py._save.
    """
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.flush()
        try:
            os.fsync(f.fileno())
        except (OSError, AttributeError):
            pass
    os.replace(tmp, path)


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
        # Guards _messages dict and the two JSON files. RLock so methods
        # that call each other (create → _save_messages) don't self-deadlock.
        self._lock = threading.RLock()

    # ── session persistence ──────────────────────────────────────────────────

    def load(self):
        """Return list of all sessions from disk."""
        with self._lock:
            if os.path.exists(self._file):
                with open(self._file, "r", encoding="utf-8") as f:
                    return json.load(f)
            return []

    def _save(self, sessions):
        with self._lock:
            _atomic_write_json(self._file, sessions)

    # ── message persistence ──────────────────────────────────────────────────

    def _load_messages(self):
        """Load all messages from disk into cache."""
        with self._lock:
            if os.path.exists(self._msg_file):
                try:
                    with open(self._msg_file, "r", encoding="utf-8") as f:
                        return json.load(f)
                except Exception:
                    pass
            return {}

    def _save_messages(self, all_msgs):
        with self._lock:
            _atomic_write_json(self._msg_file, all_msgs)

    # ── session lifecycle ────────────────────────────────────────────────────

    def create(self, title="New Chat"):
        """Create a new session and return it."""
        with self._lock:
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
        with self._lock:
            sessions = [s for s in self.load() if s["id"] != sid]
            self._save(sessions)
            self._messages.pop(sid, None)
            all_msgs = self._load_messages()
            all_msgs.pop(sid, None)
            self._save_messages(all_msgs)

    # ── message access ───────────────────────────────────────────────────────

    def get_messages(self, sid):
        """Return messages for session, loading from disk if needed."""
        with self._lock:
            if sid not in self._messages:
                all_msgs = self._load_messages()
                if sid in all_msgs:
                    self._messages[sid] = all_msgs[sid]
                else:
                    self._messages[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
            return self._messages[sid]

    def set_messages(self, sid, msgs):
        """Update messages in memory and persist to disk."""
        with self._lock:
            self._messages[sid] = msgs
            all_msgs = self._load_messages()
            all_msgs[sid] = msgs
            self._save_messages(all_msgs)

    def update_title(self, sid, title):
        with self._lock:
            sessions = self.load()
            for s in sessions:
                if s["id"] == sid and s["title"] == "New Chat":
                    s["title"]   = title[:50] + ("..." if len(title) > 50 else "")
                    s["updated"] = datetime.datetime.now().isoformat()
                    self._save(sessions)
                    break
