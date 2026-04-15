"""
auth/middleware.py — Flask-Login setup + role enforcement + audit hook.

Three auth modes (AZIRO_AUTH_MODE):
- "apikey"  — legacy Bearer-token auth (current behavior). Default.
- "session" — Flask-Login session cookies. The API key check is skipped.
- "both"    — either a valid Bearer token OR an authenticated session
              will pass. Useful during migration.

Role enforcement:
- "viewer" can GET anything but cannot POST/PUT/PATCH/DELETE outside of
  /api/v1/auth/*. Anonymous requests in "session"/"both" mode without a
  valid session return 401 for any /api/ call.
- "admin" can do everything.

Audit log:
- Every state-changing /api/ request writes one row to audit_log with
  who did what, from where, when, and what HTTP status we returned.
"""
from __future__ import annotations

import logging
import os
from functools import wraps
from typing import Optional

from flask import jsonify, request, current_app, g
from flask_login import LoginManager, current_user

from auth.db import AuthStore
from auth.models import User, ROLE_ADMIN, ROLE_VIEWER

log = logging.getLogger("aziro.auth")

AUTH_MODE_APIKEY  = "apikey"
AUTH_MODE_SESSION = "session"
AUTH_MODE_BOTH    = "both"
_VALID_MODES      = frozenset({AUTH_MODE_APIKEY, AUTH_MODE_SESSION, AUTH_MODE_BOTH})


def get_auth_mode() -> str:
    mode = os.environ.get("AZIRO_AUTH_MODE", AUTH_MODE_APIKEY).strip().lower()
    return mode if mode in _VALID_MODES else AUTH_MODE_APIKEY


# State-changing HTTP methods trigger role checks + audit entries.
_STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def init_login_manager(app, store: AuthStore) -> LoginManager:
    """Install Flask-Login on `app`. Returns the LoginManager so ui/web.py
    can hold a reference if it needs one."""
    lm = LoginManager()
    # Cookie hardening. Session lifetime defaults to Flask's permanent-
    # session (31d); our app expects shorter — override via env if needed.
    app.config.setdefault("SESSION_COOKIE_HTTPONLY", True)
    app.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
    # Secure flag: only set when AZIRO_ENABLE_HSTS is on, since that's the
    # same gate we use for "we're actually behind TLS" elsewhere. Setting
    # it over HTTP would make local dev sessions silently fail.
    if os.environ.get("AZIRO_ENABLE_HSTS", "").strip() in ("1", "true", "yes"):
        app.config["SESSION_COOKIE_SECURE"] = True

    lm.init_app(app)

    @lm.user_loader
    def _load_user(user_id: str) -> Optional[User]:
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            return None
        row = store.get_user(uid)
        if not row:
            return None
        return User(row["id"], row["username"], row["role"])

    @lm.unauthorized_handler
    def _unauthorized():
        # API clients get JSON, not a redirect.
        return jsonify({"error": "authentication required"}), 401

    return lm


def session_auth_check() -> Optional[tuple]:
    """Return (response, status) when the request must be rejected for
    session-auth reasons, else None. Called from ui/web.py's auth middleware
    only when the active mode includes session auth."""
    if current_user.is_authenticated:
        return None
    return jsonify({"error": "authentication required"}), 401


def role_check() -> Optional[tuple]:
    """Viewer-role write guard. Must be called AFTER session_auth_check
    confirms current_user.is_authenticated."""
    if request.method not in _STATE_CHANGING:
        return None
    # Auth routes themselves must be callable by everyone — logging in is
    # a POST, and we don't want to 403 a viewer trying to log out.
    if request.path.startswith("/api/v1/auth/"):
        return None
    if not current_user.is_authenticated:
        return None  # apikey mode or anonymous bypass handled upstream
    if current_user.role == ROLE_ADMIN:
        return None
    if current_user.role == ROLE_VIEWER:
        return jsonify({"error": "viewer role cannot make state changes"}), 403
    # Unknown role — fail closed.
    return jsonify({"error": "role not permitted"}), 403


def require_role(role: str):
    """Decorator for routes that need a specific role regardless of mode."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return jsonify({"error": "authentication required"}), 401
            if current_user.role != role and current_user.role != ROLE_ADMIN:
                return jsonify({"error": f"role {role!r} required"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def audit_after_request(store: AuthStore, response):
    """Write one audit_log row per state-changing /api/ request. Called
    from a Flask after_request hook. Auth routes get special-cased
    action names so login attempts are visible even when the user is
    not yet logged in."""
    if request.method not in _STATE_CHANGING:
        return response
    if not request.path.startswith("/api/"):
        return response

    try:
        if current_user.is_authenticated:
            uid = int(current_user.id)
            uname = current_user.username
        else:
            uid = None
            uname = ""

        # Prefer the request-ID bound by observability middleware.
        try:
            from observability import current_request_id
            rid = current_request_id() or ""
        except Exception:
            rid = ""

        action = f"{request.method} {request.path}"
        store.write_audit(
            user_id=uid, username=uname,
            action=action, target="",
            status=response.status_code,
            remote_ip=(request.remote_addr or ""),
            request_id=rid,
        )
    except Exception:
        # Audit log must never fail a request. Log the exception so gaps
        # are visible in ops, but always let the user's response through.
        log.exception("audit.write_failed",
                      extra={"method": request.method, "path": request.path})
    return response
