"""
agent/needs_tools.py — decide whether a message needs real infra commands or just a direct reply.
Same heuristic as kubectl-ai's _needs_tools() in app.py.
"""
import re

_GENERAL_PATTERNS = re.compile(
    r'^(hi|hello|hey|thanks|thank you|ok|okay|got it|yes|no|bye|good morning|good evening|'
    r'what is|what are|explain|how does|why is|tell me about|can you|should i|'
    r'what do you think|help me understand|difference between)\b',
    re.IGNORECASE
)

_INFRA_KEYWORDS = [
    'pod', 'node', 'deploy', 'service', 'disk', 'memory', 'cpu', 'process',
    'log', 'error', 'crash', 'restart', 'status', 'check', 'show', 'list',
    'kubectl', 'docker', 'helm', 'port', 'network', 'storage', 'uptime',
]


def needs_tools(message):
    """Return True if the message likely needs real server data (commands)."""
    if len(message.split()) <= 3 and _GENERAL_PATTERNS.match(message):
        return False
    msg_lower = message.lower()
    if any(kw in msg_lower for kw in _INFRA_KEYWORDS):
        return True
    if _GENERAL_PATTERNS.match(message):
        return False
    return True
