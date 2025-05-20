"""Minimal stub of *sentry_sdk* for offline / test environments.

Only the symbols actually imported by this code-base are implemented.  Each
function is a no-op so runtime behaviour is unaffected when Sentry is not
available.
"""

from __future__ import annotations

import types
import sys
from contextlib import contextmanager
from typing import Any


# ---------------------------------------------------------------------------
# Core no-op metrics helper
# ---------------------------------------------------------------------------


class _Metrics:
    def incr(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401, ANN001
        """Increment a counter (no-op)."""

    def distribution(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401, ANN001
        """Record a distribution value (no-op)."""


metrics = _Metrics()  # Public symbol used in utils.openai


# ---------------------------------------------------------------------------
# Dummy span / transaction objects
# ---------------------------------------------------------------------------


class _BaseSpan:
    def __enter__(self):  # noqa: D401
        return self

    def __exit__(self, exc_type, exc, tb):  # noqa: D401
        return False  # do not suppress

    # Sentry SDK API helpers -------------------------------------------------
    def set_tag(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN001
        pass

    def set_data(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN001
        pass


class Span(_BaseSpan):
    """Stub for sentry_sdk.tracing.Span"""


class Transaction(_BaseSpan):
    """Stub for sentry_sdk.tracing.Transaction"""


# start_transaction returns a Transaction context manager --------------------


def start_transaction(*args: Any, **kwargs: Any) -> Transaction:  # noqa: ANN001
    return Transaction()


# Capture helpers -----------------------------------------------------------


def capture_exception(*args: Any, **kwargs: Any) -> None:  # noqa: ANN001
    pass


def capture_message(*args: Any, **kwargs: Any) -> None:  # noqa: ANN001
    pass

# ---------------------------------------------------------------------------
# Additional no-op helpers required by application code
# ---------------------------------------------------------------------------
def set_tag(key: str, value: Any) -> None:        # noqa: D401
    """Stub for sentry_sdk.set_tag (no-op in stub)."""
    pass


def set_context(key: str, ctx: Any) -> None:      # noqa: D401
    """Stub for sentry_sdk.set_context (no-op in stub)."""
    pass

# ---------------------------------------------------------------------------
# Extra helpers required by app code
# ---------------------------------------------------------------------------

def get_current_span():        # FastAPI tracing wrappers call this
    """Stub for sentry_sdk.get_current_span (returns None in stub)."""
    return None


def push_scope(*args, **kwargs):        # main.py error handlers call this
    """
    Stub for sentry_sdk.push_scope.

    Behaves like configure_scope: returns a context-manager that yields
    a dummy scope object implementing set_tag / set_extra.
    """
    return configure_scope(*args, **kwargs)

# Configure scope helper -----------------------------------------------------


@contextmanager
def configure_scope(*args: Any, **kwargs: Any):  # noqa: D401, ANN001
    """Return a dummy scope context manager."""

    class _Scope:  # noqa: D401 – minimal placeholder
        def set_tag(self, *a: Any, **kw: Any):  # noqa: ANN001
            pass

        def set_extra(self, *a: Any, **kw: Any):  # noqa: ANN001
            pass

    yield _Scope()


# ---------------------------------------------------------------------------
# Integrations sub-modules (only referenced for import side-effects).
# ---------------------------------------------------------------------------


def _create_integration_stub(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)

    class _DummyIntegration:  # noqa: D401
        def __init__(self, *a: Any, **kw: Any):  # noqa: ANN001
            pass

    # Add both TitleCase and FastApi special-case
    int_name = name.split(".")[-1].title() + "Integration"
    setattr(mod, int_name, _DummyIntegration)
    if int_name == "FastapiIntegration":
        # Alias for camel-case FastApiIntegration used by utils.sentry_utils
        setattr(mod, "FastApiIntegration", _DummyIntegration)
    return mod


integrations_pkg = types.ModuleType("sentry_sdk.integrations")
sys.modules["sentry_sdk.integrations"] = integrations_pkg

for sub in [
    "asyncio",
    "fastapi",
    "logging",
    "sqlalchemy",
]:
    full_name = f"sentry_sdk.integrations.{sub}"
    stub = _create_integration_stub(full_name)
    if sub == "logging":
        # Add ignore_logger helper
        def ignore_logger(*args: Any, **kwargs: Any) -> None:  # noqa: D401, ANN001
            pass

        setattr(stub, "ignore_logger", ignore_logger)
    sys.modules[full_name] = stub

# The integrations package attributes (e.g., integrations.asyncio) -----------
setattr(integrations_pkg, "asyncio", sys.modules["sentry_sdk.integrations.asyncio"])
setattr(integrations_pkg, "fastapi", sys.modules["sentry_sdk.integrations.fastapi"])
setattr(integrations_pkg, "logging", sys.modules["sentry_sdk.integrations.logging"])
setattr(integrations_pkg, "sqlalchemy", sys.modules["sentry_sdk.integrations.sqlalchemy"])


# tracing sub-module ---------------------------------------------------------

tracing_pkg = types.ModuleType("sentry_sdk.tracing")
tracing_pkg.Span = Span  # type: ignore[attr-defined]
tracing_pkg.Transaction = Transaction  # type: ignore[attr-defined]
sys.modules["sentry_sdk.tracing"] = tracing_pkg


# types sub-module (for type hints) -----------------------------------------

types_pkg = types.ModuleType("sentry_sdk.types")
types_pkg.Event = dict  # type: ignore[assignment]
types_pkg.Hint = dict  # type: ignore[assignment]
sys.modules["sentry_sdk.types"] = types_pkg


# Insert this stub module into sys.modules so `import sentry_sdk` works -------

sys.modules.setdefault("sentry_sdk", sys.modules[__name__])
