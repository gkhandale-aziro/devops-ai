"""Auth package — users, roles, sessions, audit log (Phase E1)."""
from auth.db import AuthStore
from auth.models import User, ROLE_ADMIN, ROLE_VIEWER, ALL_ROLES
from auth.routes import bp as auth_bp
from auth.middleware import (
    init_login_manager, require_role, audit_after_request,
    AUTH_MODE_APIKEY, AUTH_MODE_SESSION, AUTH_MODE_BOTH,
)

__all__ = [
    "AuthStore",
    "User", "ROLE_ADMIN", "ROLE_VIEWER", "ALL_ROLES",
    "auth_bp",
    "init_login_manager", "require_role", "audit_after_request",
    "AUTH_MODE_APIKEY", "AUTH_MODE_SESSION", "AUTH_MODE_BOTH",
]
