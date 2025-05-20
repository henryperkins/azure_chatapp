from utils.context import trim_context_to_window, count_tokens_messages
from utils.ai_helper import augment_with_knowledge
from utils.model_registry import get_model_config

class ContextManager:
    def __init__(self, db, model_id: str, enable_web_search: bool = False):
        self.db = db
        self.model_id = model_id
        self.enable_web_search = enable_web_search

    async def build(
        self,
        conv,
        incoming_user_text: str,
        base_history: list[dict]
    ) -> tuple[list[dict], dict]:
        # 1️⃣ KB RAG
        kb_msgs = await augment_with_knowledge(
            conv.id, incoming_user_text, self.db
        )
        # 2️⃣ (optional) web search placeholder – add empty list for now
        web_msgs = []
        # 3️⃣ Assemble
        msgs = kb_msgs + web_msgs + base_history + [
            {"role": "user", "content": incoming_user_text}
        ]
        # 4️⃣ Trim
        max_ctx = get_model_config(self.model_id)["max_ctx"]
        msgs, removed = await trim_context_to_window(msgs, self.model_id, max_ctx)
        token_usage = count_tokens_messages(msgs, self.model_id)
        return msgs, {"removed_tokens": removed, "prompt_tokens": token_usage}
