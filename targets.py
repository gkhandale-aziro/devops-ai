"""
targets.py — manage saved targets (servers, clusters, cloud accounts).
Persisted to targets.json so they survive restarts.
"""
import json
import uuid
import os

TARGETS_FILE = os.path.join(os.path.dirname(__file__), "targets.json")


def load_targets():
    if not os.path.exists(TARGETS_FILE):
        return []
    with open(TARGETS_FILE) as f:
        return json.load(f)


def save_targets(targets):
    with open(TARGETS_FILE, "w") as f:
        json.dump(targets, f, indent=2)


def add_target(name, target_type, config):
    targets = load_targets()
    target = {
        "id":     str(uuid.uuid4()),
        "name":   name,
        "type":   target_type,   # ssh | kubernetes | docker | terraform | aws | gcp | azure
        "config": config,
        "status": "unknown"
    }
    targets.append(target)
    save_targets(targets)
    return target


def remove_target(target_id):
    targets = load_targets()
    targets = [t for t in targets if t["id"] != target_id]
    save_targets(targets)


def get_target(target_id):
    for t in load_targets():
        if t["id"] == target_id:
            return t
    return None


def update_status(target_id, status):
    """Update online/offline status of a target."""
    targets = load_targets()
    for t in targets:
        if t["id"] == target_id:
            t["status"] = status
    save_targets(targets)


def has_local_target():
    """Return True if a 'local' type target already exists."""
    return any(t.get("type") == "local" for t in load_targets())
