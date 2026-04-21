"""
tests/conftest.py — cross-cutting pytest fixtures.

The process-wide engine in `store.engine` is cached the first time any
store or auth DB call runs. Tests that monkeypatch `AZIRO_DATA_DIR` /
`AZIRO_DB_URL` and then reload `store.db` / `auth.db` still hit the
*previously* resolved engine unless we also drop it — which produces
confusing UNIQUE-constraint failures (test #2's "alice" collides with
test #1's "alice" in the leaked engine's DB).

The autouse fixture below calls `reset_engine()` around every test so
the next `get_engine()` re-resolves against the current env.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_process_engine_between_tests():
    # Reset before the test so the first get_engine() call inside the
    # test re-resolves against whatever monkeypatch has set up.
    # Don't swallow failures here — a reset_engine() exception means
    # the previous test leaked state and the next test would silently
    # run with wrong isolation; let it surface immediately.
    #
    # NOTE: we used to also `sys.modules.pop("store.engine", None)` at
    # teardown — that was counterproductive. `store/db.py` and
    # `auth/db.py` bind `get_engine` at import time, so popping the
    # module left them pointing at the OLD module object's
    # `_PROCESS_ENGINE` while any fresh `import store.engine` would
    # create a second module instance with its own `_PROCESS_ENGINE`.
    # `reset_engine()` alone gives a clean reset without the schism.
    from store.engine import reset_engine
    reset_engine()

    yield

    # And again after, so a test that didn't monkeypatch doesn't inherit
    # the engine built by a test that did.
    from store.engine import reset_engine as _reset_engine
    _reset_engine()
