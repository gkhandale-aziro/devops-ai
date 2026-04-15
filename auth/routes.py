"""
auth/routes.py — /api/v1/auth/{login,logout,me,users}.

The blueprint is registered on the Flask app from ui/web.py. Handlers
accept JSON only (no HTML form posts — the frontend is a SPA).
"""
from __future__ import annotations

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_user, logout_user, current_user, login_required

from auth.db import AuthStore
from auth.models import User, ROLE_ADMIN

bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")


def _store() -> AuthStore:
    # Stashed on the app by ui/web.py at boot.
    return current_app.extensions["aziro_auth_store"]


@bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({"error": "username and password required"}), 400

    store = _store()
    remote = request.remote_addr or ""

    if store.is_locked_out(username):
        return jsonify({"error": "account temporarily locked"}), 429

    row = store.verify_password(username, password)
    if not row:
        store.record_login_failure(username, remote)
        return jsonify({"error": "invalid credentials"}), 401

    user = User(row["id"], row["username"], row["role"])
    login_user(user)
    store.record_login_success(row["id"])
    store.clear_login_failures(username)
    return jsonify({"user": {"id": user.id, "username": user.username, "role": user.role}})


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"status": "ok"})


@bp.route("/me", methods=["GET"])
def me():
    """Returns the current user, or 401 when anonymous. Frontend calls
    this on mount to decide whether to show the app or the login page."""
    if not current_user.is_authenticated:
        return jsonify({"error": "not authenticated"}), 401
    return jsonify({
        "id":       current_user.id,
        "username": current_user.username,
        "role":     current_user.role,
    })


@bp.route("/users", methods=["POST"])
@login_required
def create_user():
    """Admin-only: provision a new user."""
    if current_user.role != ROLE_ADMIN:
        return jsonify({"error": "admin role required"}), 403
    data = request.get_json(silent=True) or {}
    try:
        created = _store().create_user(
            username=data.get("username", ""),
            password=data.get("password", ""),
            role=data.get("role", "viewer"),
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"user": created}), 201
