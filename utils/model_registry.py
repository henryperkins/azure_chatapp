"""model_registry.py
Centralised helpers for:

1. Retrieving a model's configuration from *settings* regardless of provider.
2. Validating that a requested model supports a given set of parameters / capabilities.

All other modules (conversation_service, utils.ai_helper, utils.openai, etc.)
should import from this module instead of rolling their own helpers. Thin wrappers
are kept in the legacy modules so existing call-sites continue to work until they
are refactored.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from config import settings, Settings

logger = logging.getLogger(__name__)


def get_model_config(model_name: str, config: Settings = settings) -> Optional[Dict[str, Any]]:
    """Return the configuration dict for *model_name* or *None* if not found.*"""

    # Trim whitespace, normalise simple alias mapping (hyphens vs dots, etc.)
    normalised = model_name.strip()

    alias_map = {
        # Alias forms       canonical key in settings
        "gpt-4-1": "gpt-4.1",
        "gpt-4-1-mini": "gpt-4.1-mini",
    }

    lookup_key = alias_map.get(normalised.lower(), normalised)

    # First check Azure OpenAI models
    if lookup_key in config.AZURE_OPENAI_MODELS:
        return config.AZURE_OPENAI_MODELS[lookup_key]

    # Then Anthropic / Claude models
    if lookup_key in config.CLAUDE_MODELS:
        return config.CLAUDE_MODELS[lookup_key]

    # Case-insensitive fallback
    for name, cfg in config.AZURE_OPENAI_MODELS.items():
        if name.lower() == lookup_key.lower():
            return cfg

    for name, cfg in config.CLAUDE_MODELS.items():
        if name.lower() == lookup_key.lower():
            return cfg

    logger.debug("Model config not found for '%s'", model_name)
    return None


def validate_model_and_params(model_id: str, params: Dict[str, Any] | None = None) -> None:
    """Raise *ValueError* if *params* contains options unsupported by the model.*"""

    params = params or {}

    model_cfg = get_model_config(model_id)
    if not model_cfg:
        raise ValueError(f"Unsupported or unknown model ID: {model_id}")

    capabilities = model_cfg.get("capabilities", [])
    param_cfg = model_cfg.get("parameters", {})

    # Vision / image support -------------------------------------------------
    if params.get("image_data") is not None:
        if "vision" not in capabilities:
            raise ValueError(f"Model '{model_id}' does not support vision inputs.")

        vision_detail = params.get("vision_detail", "auto")
        valid_details = param_cfg.get("vision_detail")
        if valid_details and vision_detail not in valid_details:
            raise ValueError(
                f"Invalid vision_detail '{vision_detail}' for {model_id}. "
                f"Valid values: {valid_details}"
            )

    # Reasoning effort -------------------------------------------------------
    if params.get("reasoning_effort") is not None:
        if "reasoning_effort" not in capabilities:
            raise ValueError(f"Model '{model_id}' does not support reasoning_effort.")

        reasoning_effort = params.get("reasoning_effort")
        valid_efforts = param_cfg.get("reasoning_effort")
        if valid_efforts and reasoning_effort not in valid_efforts:
            raise ValueError(
                f"Invalid reasoning_effort '{reasoning_effort}' for {model_id}. "
                f"Valid values: {valid_efforts}"
            )

    # Extended thinking ------------------------------------------------------
    if params.get("enable_thinking") is not None:
        if "extended_thinking" not in capabilities:
            raise ValueError(f"Model '{model_id}' does not support extended thinking.")

        thinking_budget = params.get("thinking_budget")
        ext_cfg = model_cfg.get("extended_thinking_config", {})
        if thinking_budget is not None and ext_cfg:
            min_budget = ext_cfg.get("min_budget", 0)
            if thinking_budget < min_budget:
                raise ValueError(
                    f"thinking_budget {thinking_budget} is below minimum {min_budget} for {model_id}."
                )

    # TODO: temperature / top_p / max_tokens range checks can be added here

    # If we reach here everything is valid
