import logging
from utils.tokens import count_tokens_messages
from utils.ai_helper import augment_with_knowledge
from utils.model_registry import get_model_config

logger = logging.getLogger(__name__)


async def trim_context_to_window(
    msgs: list[dict],
    model_id: str,
    max_ctx: int,
) -> tuple[list[dict], int]:
    """
    Trims a list of message dicts so the total token count (by model) does not exceed max_ctx.
    Returns (trimmed_msgs, removed_tokens): dropped oldest messages as needed.

    Optimized to avoid O(n²) performance by tracking token counts incrementally.
    """
    total_tokens = count_tokens_messages(msgs, model_id)
    if total_tokens <= max_ctx:
        return msgs, 0

    trimmed = list(msgs)  # shallow copy to preserve caller's list
    removed_tokens = 0
    current_tokens = total_tokens

    # Preferential trimming strategy:
    #   1. Drop *non-system* messages (oldest first) to preserve knowledge-base
    #      context that is usually encoded as `role == "system"`.
    #   2. If only system messages remain and we still exceed the window, fall
    #      back to FIFO trimming.
    while trimmed and current_tokens > max_ctx:
        # Locate first candidate that is *not* a system-level message.
        idx_to_remove = next(
            (i for i, m in enumerate(trimmed) if m.get("role") != "system"),
            0,  # Fallback to oldest message (idx 0) if all are system
        )

        msg = trimmed.pop(idx_to_remove)
        # Calculate tokens for removed message once and subtract from running total
        msg_tokens = count_tokens_messages([msg], model_id)
        removed_tokens += msg_tokens
        current_tokens -= msg_tokens

    return trimmed, removed_tokens


class ContextManager:
    def __init__(self, db, model_id: str, enable_web_search: bool = False):
        self.db = db
        self.model_id = model_id
        self.enable_web_search = enable_web_search

    async def build(
        self, conv, incoming_user_text: str, base_history: list[dict]
    ) -> tuple[list[dict], dict]:
        logger.debug(
            "Building context for conversation",
            extra={
                "event_type": "context_build_start",
                "conversation_id": str(conv.id),
                "model_id": self.model_id,
                "base_history_count": len(base_history),
                "user_text_length": len(incoming_user_text),
                "enable_web_search": self.enable_web_search,
            },
        )

        # 1️⃣ KB RAG
        kb_msgs = await augment_with_knowledge(conv.id, incoming_user_text, self.db)
        logger.debug(
            "Knowledge base augmentation completed",
            extra={
                "event_type": "kb_augmentation_complete",
                "conversation_id": str(conv.id),
                "kb_messages_count": len(kb_msgs),
            },
        )

        # 2️⃣ (optional) web search placeholder – add empty list for now
        web_msgs = []

        # 3️⃣ Assemble
        msgs = (
            kb_msgs
            + web_msgs
            + base_history
            + [{"role": "user", "content": incoming_user_text}]
        )

        # 4️⃣ Trim
        model_cfg = get_model_config(self.model_id) or {}
        max_ctx = (
            model_cfg.get("max_context_tokens")  # ← canonical key
            or model_cfg.get("max_ctx")  # ← legacy fallback
            or 8192  # ← hard-stop default
        )

        orig_msg_count = len(msgs)
        orig_token_count = count_tokens_messages(msgs, self.model_id)
        msgs, tokens_removed_count = await trim_context_to_window(
            msgs, self.model_id, max_ctx
        )
        # Calculate final token usage by subtracting removed tokens (avoids double counting)
        token_usage = orig_token_count - tokens_removed_count
        messages_removed_count = orig_msg_count - len(msgs)

        truncation_details = {
            "is_truncated": messages_removed_count > 0 or tokens_removed_count > 0,
            "messages_removed_count": messages_removed_count,
            "tokens_removed_count": tokens_removed_count,
        }

        stats = {
            "removed_tokens": tokens_removed_count,
            "prompt_tokens": token_usage,
            "current_tokens": token_usage,
            "max_tokens_for_model": max_ctx,
            "message_count_in_context": len(msgs),
            "truncation_details": truncation_details,
        }

        logger.info(
            "Context build completed",
            extra={
                "event_type": "context_build_complete",
                "conversation_id": str(conv.id),
                "model_id": self.model_id,
                "final_message_count": len(msgs),
                "final_token_count": token_usage,
                "max_context_tokens": max_ctx,
                "messages_removed": messages_removed_count,
                "tokens_removed": tokens_removed_count,
                "is_truncated": truncation_details["is_truncated"],
            },
        )

        return msgs, stats
