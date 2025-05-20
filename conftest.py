"""Global pytest configuration / lightweight fixtures for the code-base tests.

We provide **minimal** replacements for external dependencies so that the core
unit-tests can import modules without requiring the full FastAPI stack or
Sentry SDK.
"""

import pytest


try:
    from fastapi import Response  # type: ignore
except ImportError:  # pragma: no cover – our fastapi stub provides Response
    from fastapi import Response  # noqa: F401


@pytest.fixture
def response():  # noqa: D401
    """Return a dummy FastAPI Response instance for route handlers."""

    return Response()
