"""auth/models.py — Flask-Login User model."""
from __future__ import annotations

from flask_login import UserMixin

ROLE_ADMIN  = "admin"
ROLE_VIEWER = "viewer"
ALL_ROLES   = frozenset({ROLE_ADMIN, ROLE_VIEWER})


class User(UserMixin):
    """Minimal Flask-Login wrapper around the users table.

    `get_id()` is required by Flask-Login — it's what lands in the session
    cookie. We stringify the int id; the loader reverses it.
    """

    def __init__(self, uid: int, username: str, role: str):
        self.id       = uid
        self.username = username
        self.role     = role

    def get_id(self) -> str:
        return str(self.id)

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User id={self.id} {self.username!r} role={self.role!r}>"
