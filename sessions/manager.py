"""
sessions/manager.py — general AI chat session persistence (ChatGPT-style).
"""
import os
import json
import uuid
import datetime

SESSIONS_FILE = os.path.join(os.path.dirname(__file__), "..", "chat_sessions.json")

_messages = {}  # session_id → list of messages (in-memory)

SYSTEM_PROMPT = (
    "You are Aziro Ops — a helpful AI assistant for DevOps teams. "
    "Answer questions clearly and concisely. Use markdown formatting. "
    "You can discuss any topic: DevOps, Kubernetes, Docker, cloud, coding, general knowledge, etc."
)


def load_sessions():
    if os.path.exists(SESSIONS_FILE):
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_sessions(sessions):
    with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2)


MAX_SESSIONS = 100


def create_session(title="New Chat"):
    sid      = str(uuid.uuid4())[:8]
    sessions = load_sessions()
    session  = {"id": sid, "title": title, "created": datetime.datetime.now().isoformat()}
    sessions.insert(0, session)
    # Trim oldest sessions beyond MAX_SESSIONS
    sessions = sessions[:MAX_SESSIONS]
    save_sessions(sessions)
    _messages[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
    return session


def delete_session(sid):
    sessions = [s for s in load_sessions() if s["id"] != sid]
    save_sessions(sessions)
    _messages.pop(sid, None)


def get_session_messages(sid):
    if sid not in _messages:
        _messages[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
    return _messages[sid]


def set_session_messages(sid, msgs):
    _messages[sid] = msgs


def update_session_title(sid, title):
    sessions = load_sessions()
    for s in sessions:
        if s["id"] == sid and s["title"] == "New Chat":
            s["title"] = title[:50] + ("..." if len(title) > 50 else "")
            save_sessions(sessions)
            break
