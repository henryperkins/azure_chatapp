"""tokens.py
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

import importlib

logger = logging.getLogger(__name__)


# Optional dependency --------------------------------------------------------

_tiktoken_spec = importlib.util.find_spec("tiktoken")
if _tiktoken_spec is not None:  # pragma: no cover – environment-dependent
    import tiktoken  # type: ignore

    # Cache the encoder so we don’t re-initialise it on every call
    _ENCODER = tiktoken.get_encoding("cl100k_base")      # NEW

    def _encode(text: str) -> int:                       # UPDATED
        """
        Return the token count for *text* using tiktoken.
        A cached encoder is reused for performance.
        """
        try:
            return len(_ENCODER.encode(text))
        except Exception as exc:        # pragma: no cover – unlikely branch
            logger.debug("tiktoken failure: %s", exc)
            return -1

else:  # pragma: no cover

    def _encode(text: str) -> int:  # type: ignore
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
        return tok_count

    # Fallback – simple heuristic (4 chars ≈ 1 token)
    return (len(text) + 3) // 4


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
