"""
tokens.py
Unified token-counting helpers.

Two public helpers are provided so callers can work with raw text *or* the full
list-of-messages structure common to OpenAI / Anthropic chat APIs.

Implementation notes:
* If *tiktoken* is available we use the `cl100k_base` encoding which covers all
  GPT-3.5 / GPT-4 family models.  That encoding deliberately over-counts a bit
  for Anthropic models but is a safe ceiling.
* When tiktoken is missing – or for other providers – we fall back to a rough
  estimate of 4 characters per token (same heuristic already used throughout
  the codebase).
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

import importlib.util

logger = logging.getLogger(__name__)


# Optional dependency --------------------------------------------------------

# Detect sandbox/network-disabled environments ---------------------------------
import os

_ENCODER = None  # will remain None if tiktoken path unavailable

_SANDBOX_DISABLED = os.getenv("CODEX_SANDBOX_NETWORK_DISABLED") == "1"

_tiktoken_spec = None if _SANDBOX_DISABLED else importlib.util.find_spec("tiktoken")

if _tiktoken_spec is not None:  # pragma: no cover – environment-dependent
    import tiktoken  # type: ignore

    try:
        # This may attempt a network download for the encoding file.  If that
        # fails (e.g., network blocked), we catch the exception and fall back
        # to heuristic mode.
        _ENCODER = tiktoken.get_encoding("cl100k_base")
    except Exception as exc:  # pragma: no cover – likely in sandbox
        logger.debug("tiktoken initialisation failed; falling back (%s)", exc)
        _ENCODER = None

    def _encode(text: str) -> int:  # UPDATED
        """Return token count for *text* using tiktoken when available."""
        if _ENCODER is None:
            return -1
        try:
            return len(_ENCODER.encode(text))
        except Exception as exc:  # pragma: no cover – catch any runtime issue
            logger.debug("tiktoken failure: %s", exc)
            return -1

else:  # pragma: no cover

    def _encode(_text: str) -> int:  # type: ignore
        return -1  # force fallback


# Public helpers -------------------------------------------------------------


def count_tokens_text(text: str, model_id: Optional[str] = None) -> int:
    """Return token estimate for *text*.

    The result is provider-aware when *model_id* is supplied, otherwise a safe
    tiktoken-based (or heuristic) count is returned.
    """

    if not text:
        return 0

    # Use tiktoken path if available (works well for Azure/OpenAI family)
    tok_count = _encode(text)
    if tok_count != -1:
        logger.debug(
            "Token count calculated using tiktoken",
            extra={
                "event_type": "token_count_tiktoken",
                "text_length": len(text),
                "token_count": tok_count,
                "model_id": model_id,
            },
        )
        return tok_count

    # Fallback – simple heuristic (4 chars ≈ 1 token)
    fallback_count = (len(text) + 3) // 4
    logger.debug(
        "Token count calculated using fallback heuristic",
        extra={
            "event_type": "token_count_fallback",
            "text_length": len(text),
            "token_count": fallback_count,
            "model_id": model_id,
        },
    )
    return fallback_count


def count_tokens_messages(
    messages: List[dict[str, Any]], model_id: Optional[str] = None
) -> int:
    """Return combined token estimate for a list of chat *messages*."""

    total = 0
    for msg in messages:
        content = msg.get("content", "") if isinstance(msg, dict) else ""
        total += count_tokens_text(str(content), model_id=model_id)

        # Very rough overhead for metadata – we do *not* call tiktoken here
        if "metadata" in msg and isinstance(msg["metadata"], dict):
            total += (len(str(msg["metadata"])) + 7) // 8

    return total
