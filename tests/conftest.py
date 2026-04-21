"""
tests/conftest.py — cross-cutting pytest fixtures.

The process-wide engine in `store.engine` is cached the first time any
store or auth DB call runs. Tests that monkeypatch `AZIRO_DATA_DIR` /
`AZIRO_DB_URL` and then reload `store.db` / `auth.db` still hit the
*previously* resolved engine unless we also drop it — which produces
confusing UNIQUE-constraint failures (test #2's "alice" collides with
test #1's "alice" in the leaked engine's DB).

The autouse fixture below resets the engine around every test, and also
pops `store.engine` from `sys.modules` so any import after the reset
re-runs URL resolution from the current env vars.
"""
from __future__ import annotations

import sys

import pytest


@pytest.fixture(autouse=True)
def _reset_process_engine_between_tests():
    # Reset before the test so the first get_engine() call inside the
    # test re-resolves against whatever monkeypatch has set up.
    try:
        from store.engine import reset_engine
        reset_engine()
    except Exception:
        pass

    yield

    # And again after, so a test that didn't monkeypatch doesn't inherit
    # the engine built by a test that did.
    try:
        from store.engine import reset_engine
        reset_engine()
    except Exception:
        pass
    sys.modules.pop("store.engine", None)
