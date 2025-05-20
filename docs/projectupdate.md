## **PROJECT PROMPT: Consolidate and Upgrade Project-Based Chat Interface**

### 1. Issue / Question Restatement

You're looking for detailed, file-specific implementation instructions to apply the 7-point chat refactoring plan to the `henryperkins/azure_chatapp` codebase, covering project-centric chat, context management, model configuration persistence, message schema changes, inline UI features, KB/web search integration, and cleanup.

---

### 2. Implementation Roadmap

This roadmap outlines the necessary changes within your existing application structure, based on the provided plan and common file names from your repository.

1. **Backend Model & Schema Updates:**
    - Modify `models/conversation.py` and `models/message.py`.
    - Create/update migrations in `db/schema_manager.py`.
    - Add `tiktoken` to `requirements.txt`.
2. **Service Layer Enhancements:**
    - Update `services/conversation_service.py` for token counting, truncation, RAG, model config handling, and raw/formatted text.
    - Potentially update `services/knowledgebase_service.py` for interaction with `conversation_service`.
3. **API Endpoint Modifications:**
    - Adjust `routes/unified_conversations.py` to handle new model config fields, message formats, and UI feature support (title edit, delete).
4. **Frontend UI & Logic:**
    - Refactor `static/js/chat.js` (your `ChatManager`) for new UI features, token stats display, and retry logic.
    - Update `static/js/modelConfig.js` for new model parameters and web search toggle.
    - Modify related HTML templates (e.g., `static/html/project_details.html` or `static/html/chat_ui.html`) to include new UI elements.
    - Adjust `static/js/sidebar.js` or `static/js/projectDetailsComponent.js` to ensure project-only chat navigation.
5. **Utility & Helper Adjustments:**
    - Update `utils/ai_helper.py` if web search logic is centralized there.
    - Ensure `utils/serializers.py` can handle the updated `Conversation` and `Message` models.
6. **Cleanup:**
    - Systematically remove old standalone chat routes, services, UI elements, and JavaScript initializers.

---

Okay, I've analyzed your implementation plan against the provided codebase files. This detailed breakdown aims to give you precise, actionable instructions for your `henryperkins/azure_chatapp` application.

### 1. Issue / Question Restatement

You require specific, customized implementation instructions for your application, mapping your 7-point plan to the actual files (`routes/unified_conversations.py`, `services/conversation_service.py`, `models/conversation.py`, `static/js/chat.js`, `static/js/modelConfig.js`, `utils/ai_helper.py`, `services/knowledgebase_service.py`, and `README.md`) to centralize chat logic, manage context and tokens, persist configurations, enhance the database, add inline UI features, integrate RAG/web search, and perform cleanups.

---

### 2. Plan Adaptation Strategy

To provide actionable instructions, I will go through each of the 7 sections in your implementation plan. For every point, I will:

1. Identify the core task described.
2. Pinpoint the relevant functions, classes, or methods within the provided Python backend files (`unified_conversations.py`, `conversation_service.py`, `models/conversation.py`, `ai_helper.py`, `knowledgebase_service.py`) and JavaScript frontend files (`chat.js`, `modelConfig.js`).
3. Detail the necessary modifications or additions in these specific files.
4. For files mentioned in your plan but not included in the latest upload (e.g., `db/schema_manager.py`, `models/message.py`, `static/js/sidebar.js`), I will describe the conceptual changes based on your plan and analogous structures in the provided files.
5. Reference information from `README.md` where it clarifies existing structures or flows.

This approach ensures the instructions are directly applicable to your codebase.

---

### 3. Detailed Implementation Instructions

Here are the customized instructions based on your plan and the provided files:

**Section 1: Refactor Chat into Project Context**

- **Task:** Ensure all chat functionality is strictly project-based and remove standalone chat remnants.
- **Files & Instructions:**
    - `routes/unified_conversations.py`:
        - Review all route handlers (e.g., `list_project_conversations` L81, `create_conversation` L144, `get_project_conversation` L270, `create_project_conversation_message` L475). Ensure each one robustly uses and validates the `project_id` path parameter.
        - The `ConversationService` methods called by these routes, like `conv_service.create_conversation()` (used in L192), already seem to enforce `project_id` via `_require_project_id()` in `conversation_service.py` (L150). Confirm this pattern is consistently applied for all conversation and message operations.
    - `static/js/chat.js`:
        - In `ChatManager.initialize` (around L185), the logic for `requestedProjectId` correctly prioritizes `options.projectId`.
        - `ChatManager.loadConversation` (around L278) checks `this.isValidProjectId(this.projectId)`.
        - Ensure any code paths that could lead to creating or loading a conversation without a `projectId` are removed or updated to enforce it. The `README.md` sequence diagram shows `chatManager.loadConversation()` being called with project and chat IDs, reinforcing this.
    - `static/js/sidebar.js` (not provided):
        - As per your plan, review this file (once located) to remove any UI elements or event listeners that link to or initialize a standalone/global chat page. Navigation should guide users to project-specific chat instances.
    - `static/js/projectDetailsComponent.js` (not provided, but `chat.js` L27 lists it as a dependency):
        - Similar to `sidebar.js`, ensure this component, when initializing chat, does so strictly within the current project's context.

**Section 2: Per-Conversation Context Management**

- **Task:** Implement precise token counting, context window truncation, and live UI stats.
- **Files & Instructions:**
    - `services/conversation_service.py`:
        - Inside `create_message` (around L413), before the call to `generate_ai_response` (L454):
            1. Fetch the message history for the `conversation_id`. The existing `_get_conversation_context` method (L538) can be adapted or used.
            2. Implement the token counting logic from your plan using `tiktoken`. You can use `calculate_tokens` from `utils/ai_helper.py` (L64) which already uses `tiktoken`. Sum the tokens for all messages in history plus the new user message.
            3. Apply the truncation logic (Python `while` loop from your plan) if `total_tokens + tokens_for_new_msg > model_context_limit`. The `model_context_limit` should be fetched based on `conv.model_id` (see `utils/ai_helper.py` `get_model_config` L43). Messages should be popped from the beginning of the history.
            4. If truncation occurs, the response from `create_message` should signal this to the frontend. Modify the `response` dictionary (currently holding `user_message` and `assistant_message`/`assistant_error`) to include a flag or message, e.g., `response["truncation_warning"] = "Oldest messages removed..."`.
    - `routes/unified_conversations.py`:
        - The `create_project_conversation_message` endpoint (L475) will return the modified `response` dictionary from `conv_service.create_message`. The frontend will check for the `truncation_warning`. Your plan's suggestion of HTTP 413 might be too strong if the message is still processed; a success response with a warning field is often preferred.
    - `static/js/chat.js`:
        - Token Stats Display:
            - Create a new UI section (e.g., a `div` in `static/html/project_details.html` or `chat_ui.html` if that's where the project chat UI lives) to display "Input tokens", "Completion tokens", and "Reasoning (context) tokens".
            - In `_processAssistantResponse` (L451), when an assistant message is received, the backend should ideally return `prompt_tokens` and `completion_tokens` for the last exchange, and `total_context_tokens` for the conversation. Update the stats display here.
            - If a `truncation_warning` is received from the backend, display it to the user (e.g., using `_showErrorMessage` L718, or a less intrusive notification).
        - Live Token Estimation (on user input):
            - Add an event listener (debounced) to the input field (`this.inputField` L145).
            - On input, estimate total tokens: current conversation messages (need to fetch/store them client-side or make a lightweight API call) + current input field text. Use a client-side `tiktoken` library if feasible, or make a dedicated backend endpoint for estimation. Display this "ghost counter" near the input field.
    - `static/js/modelConfig.js`:
        - When the model changes via `updateModelConfig` (L221), the new `model_context_limit` (if it varies by model) needs to be communicated to `chat.js`. The existing `notifyChatManager` (L214) can be enhanced, or `chat.js` can fetch it.

**Section 3: Persist Model Configuration per Conversation**

- **Task:** Store detailed model parameters (model_name, temperature, etc.) directly in the `Conversation` model.
- **Files & Instructions:**
    - `models/conversation.py`:
        - Modify the `Conversation` class (L32):
            - Add the new `Mapped` columns as specified in your plan's diff: `model_name: Mapped[str] = mapped_column(String, nullable=False, default='gpt-4')` (adjust default as needed), `temperature: Mapped[float]`, `top_p: Mapped[float]`, etc.
            - The existing `extra_data: Mapped[Optional[dict]]` (L56) currently holds `ai_settings`. You can choose to migrate these settings to the new columns and deprecate `extra_data["ai_settings"]`, or use the new columns for primary settings and `extra_data` for less common/future ones.
    - `db/schema_manager.py` (not provided):
        - Create an Alembic (or your chosen migration tool) migration script. This script should use `op.add_column()` for each new field in the `conversations` table, similar to the diff you provided in your plan.
    - `services/conversation_service.py`:
        - `create_conversation` (L180):
            - Update the method signature to accept the new parameters (e.g., `temperature: Optional[float] = None`, etc.).
            - When instantiating `Conversation` (L214), set these new direct attributes.
            - The `ai_settings: Optional[dict[str, Any]] = None` parameter might still be used for settings not promoted to dedicated columns or for backward compatibility during transition.
        - `update_conversation` (L280):
            - Update signature to accept new parameters for update.
            - Modify the update logic (around L290-L334) to set these direct attributes on the `conv` object.
        - `get_conversation` (L231): This method currently returns `serialize_conversation(conv)`.
    - `utils/serializers.py` (not provided):
        - Modify `serialize_conversation` to include these new columns from the `Conversation` object in its output dictionary.
    - `routes/unified_conversations.py`:
        - `ConversationCreate` Pydantic model (L37): Add the new fields (e.g., `temperature: Optional[float] = Field(1.0)`). The existing `ai_settings: Optional[dict]` might be phased out or reduced in scope.
        - `ConversationUpdate` Pydantic model (L45): Add the new optional fields.
        - `create_conversation` endpoint (L144): The `conversation_data` object will now contain the new fields. Pass them to `conv_service.create_conversation`.
        - `update_project_conversation` endpoint (L317): The `update_data` object will now contain the new fields. Pass them to `conv_service.update_conversation`.
        - `get_project_conversation` endpoint (L270): The response, via the updated `serialize_conversation`, will now include these new fields.
    - `static/js/modelConfig.js`:
        - `initializeUI` (L265): Add new input elements (sliders, selects as appropriate) to the sidebar panel (referenced in your plan, likely part of `static/html/base.html` or `project_details.html`) for each new model parameter.
        - The "Save" button's event listener (implied, as `updateModelConfig` L221 is called) should gather values from these new inputs and include them in the payload for the `PATCH /api/projects/{id}/conversations/{cid}` request.
        - When a conversation is loaded by `chat.js`, its specific model settings (now part of the conversation data) should be used to populate these UI fields in `modelConfig.js`. This might involve `chat.js` calling a method on `modelConfig.js` (like `updateConfig` L221, but with data from the current conversation).

**Section 4: Database: Raw vs. Formatted Messages**

- **Task:** Store both raw and HTML-rendered versions of message content.
- **Files & Instructions:**
    - `models/message.py` (not provided):
        - Modify the `Message` model class: Add `raw_text: Mapped[str] = mapped_column(Text, nullable=False)` and `formatted_text: Mapped[str] = mapped_column(Text, nullable=False)`.
        - The existing `content: Mapped[str]` column might be repurposed for `raw_text` or removed if `raw_text` replaces it. Your diff implies adding new columns and keeping a `content` column (perhaps `raw_text` is the new name for `content`). Clarify if `content` should remain or be replaced by `raw_text`. Assuming `raw_text` is the source of truth and `formatted_text` is derived.
    - `db/schema_manager.py` (not provided):
        - Add an Alembic migration for the `messages` table to include `raw_text` and `formatted_text` columns.
    - `services/conversation_service.py`:
        - `_create_user_message` (L496):
            - Store the incoming `content` parameter into `message.raw_text`.
            - Use a Markdown rendering library (e.g., `markdown2` or `mistune`, which you'd add to `requirements.txt`) to convert `message.raw_text` to HTML.
            - Sanitize this HTML (e.g., using `bleach`, also to be added to `requirements.txt`) to prevent XSS.
            - Store the sanitized HTML in `message.formatted_text`.
        - In `create_message` (L413), when `generate_ai_response` (L454) returns the assistant's message, the logic that saves this assistant message (within `generate_ai_response` or immediately after) must similarly populate `raw_text` (assistant's raw Markdown/text output) and `formatted_text` (rendered and sanitized HTML).
        - `list_messages` (L387): Ensure `serialize_message` (from `utils/serializers.py`, not provided) returns `formatted_text` for display and `raw_text` for "copy" functionality.
    - `utils/serializers.py` (not provided):
        - Modify `serialize_message` to include `raw_text` and `formatted_text`.
    - `routes/unified_conversations.py`:
        - `create_project_conversation_message` endpoint (L475): The `new_msg.content` (L514) is the raw user input. The service layer handles creating `raw_text` and `formatted_text`. The response `payload` (L571) should reflect these fields through the updated `serialize_message`.
        - `list_project_conversation_messages` endpoint (L757): The `messages` in the payload (L797) will now contain both text versions via `serialize_message`.
    - `static/js/chat.js`:
        - `_showMessage` (L604):
            - It should now expect `formatted_text` in the message object.
            - Change `this.domAPI.setInnerHTML(contentEl, this.DOMPurify.sanitize(content || "", ...))` (L633) to `this.domAPI.setInnerHTML(contentEl, message.formatted_text)`.
            - Since the backend is providing pre-sanitized HTML, `DOMPurify.sanitize()` here becomes a defense-in-depth measure or could be removed if backend sanitization is trusted. It's safer to keep it.
            - Ensure `raw_text` is also available (e.g., as a data attribute on the message element) if needed for the "Copy Message" feature.

**Section 5: Inline Chat UI Features**

- **Task:** Implement UI controls for editing title, deleting chat, copying messages, ensuring Markdown rendering, and retrying generation.
- **Files & Instructions:**
    - `static/js/chat.js`:
        - **Edit Chat Title**:
            - `this.titleElement` (L147) displays the title. Add an event listener (e.g., click to transform into an input field, or show a modal).
            - On save, make a `PATCH` request to `apiEndpoints.CONVERSATION(this.projectId, this.currentConversationId)` (similar to `deleteConversation` L470 but with `PATCH`). The body should be `{ "title": newTitle }`. This will hit `update_project_conversation` in `routes/unified_conversations.py` (L317).
        - **Delete Chat**:
            - The `deleteConversation` method (L470) already exists and correctly calls the `DELETE` API. A UI button (e.g., in the chat header) needs to be added and wired to call `this.deleteConversation()`.
        - **Copy Message**:
            - In `_showMessage` (L604), when rendering each message, add a "copy" icon button.
            - Attach an event listener to this button. The listener will need access to the `message.raw_text`. Store `raw_text` as a `data-raw-text` attribute on the message's DOM element or pass it to the handler.
            - On click, use `navigator.clipboard.writeText(messageRawText)`.
        - **Markdown & Code Blocks**:
            - If Section 4 is implemented correctly, `formatted_text` will be pre-rendered HTML. `chat.js`'s `_showMessage` (L604) already uses `DOMPurify.sanitize` before `setInnerHTML` (L633), which should correctly render the HTML including code blocks styled by your CSS.
        - **Retry Generation**:
            - In `_showMessage` (L604), for assistant messages, add a "Retry" button.
            - The event listener for "Retry" needs to:
                1. Retrieve the `raw_text` of the _last user message_. This implies `chat.js` might need to keep a client-side array of messages or have a way to fetch the last user message's raw content.
                2. Call `this.sendMessage(lastUserMessageRawText)` (L377). This will reuse the existing send flow.
    - `static/html/project_details.html` or `chat_ui.html` (not provided, but one hosts the chat UI):
        - Add the necessary HTML elements for "Edit Title" input, "Delete Chat" button, "Copy" icons, and "Retry" buttons within the respective templates.
    - `routes/unified_conversations.py`:
        - `update_project_conversation` (L317) handles title updates.
        - `delete_project_conversation` (L392) handles deletion.
        - `create_project_conversation_message` (L475) handles the "Retry" as a new user message.

**Section 6: Knowledge Base & Web Search Integration**

- **Task:** Augment chat with RAG from project knowledge base and optionally allow web search.
- **Files & Instructions:**
    - `services/conversation_service.py`:
        - In `create_message` (around L413), before calling `generate_ai_response` (L454):
            - Call `augment_with_knowledge` from `utils/ai_helper.py` (L233). Pass `conversation_id`, `content` (user's message), and `self.db`.
            - Prepend the list of system messages returned by `augment_with_knowledge` to the `message_history` that is passed to `generate_ai_response`.
            - If "Enable Web Search" is active (see below):
                1. Add a new parameter to `create_message` like `enable_web_search: bool = False`.
                2. If true, call a new (to-be-created) service function, e.g., `web_search_service.search(content)`.
                3. Format web search results similarly to KB results (system messages with content and source) and prepend them to `message_history`.
    - `utils/ai_helper.py`:
        - `augment_with_knowledge` (L233) already uses `search_project_context` from `knowledgebase_service.py` (L144).
        - Ensure the `metadata` in the system messages it creates includes citation information (e.g., `file_name` is already used for `source`). Your plan: `{"citation":"[1]","file_id":"…"}`. Modify L340 to structure metadata accordingly.
    - `static/js/modelConfig.js`:
        - In `initializeUI` (L265), add a checkbox for "Enable Web Search" to the model config panel.
        - When saved via `updateModelConfig` (L221), this setting should be persisted as part of the conversation's model configuration (see Section 3 changes to `models/conversation.py` and related services/routes).
    - `routes/unified_conversations.py`:
        - Update `ConversationCreate` (L37) and `ConversationUpdate` (L45) Pydantic models if `enable_web_search` becomes a persistent per-conversation setting. Alternatively, it could be a transient setting in `MessageCreate`.
        - If transient: Add `enable_web_search: Optional[bool] = Field(False)` to `MessageCreate` Pydantic model (L54).
        - The `create_project_conversation_message` endpoint (L475) would then pass `new_msg.enable_web_search` to `conv_service.create_message`.
    - `static/js/chat.js`:
        - `_showMessage` (L604): Modify to render citations. If assistant's message content includes "" strings, these could be turned into links or have hover-over popups showing source details (from message metadata).
        - When calling `_sendMessageToAPI` (L423), the `payload` should include `enable_web_search: true/false` based on the setting from `modelConfig.js`.

**Section 7: Cleanup and Review of Current Logic**

- **Task:** Audit and refactor existing codebase for consistency and removal of legacy elements.
- **Files & Instructions:**
    - **Standalone Chat Removal**:
        - Review all routes in `routes/unified_conversations.py`. Ensure none operate without a `project_id`.
        - Inspect `static/html/` files. Your `README.md` indicates `project_details.html` is key. If `chat_ui.html` represents a standalone chat, its usage should be eliminated or refactored into the project context.
    - **Context Logic**:
        - In `services/conversation_service.py`, review `_get_conversation_context` (L538). With the new token counting and truncation logic (from Section 2) implemented in `create_message`, ensure this method simply fetches historical messages and `create_message` handles the context window.
    - **Persistence Check**:
        - Confirm that `models/conversation.py` reflects all schema changes from Section 3.
        - Confirm (once `models/message.py` is available) that it reflects schema changes from Section 4.
        - `services/conversation_service.py`:
            - `serialize_conversation` (used in `get_conversation` L231, `update_conversation` L280 etc., defined in `utils/serializers.py` - not provided): Must be updated to read the new direct model config fields from the `Conversation` object.
            - `serialize_message` (used in `list_messages` L387, `create_message` L413, defined in `utils/serializers.py` - not provided): Must be updated to include `raw_text` and `formatted_text`.
    - **Database Schema**:
        - Ensure `db/schema_manager.py` (not provided) contains all Alembic migrations for changes to `conversations` (Section 3) and `messages` (Section 4) tables.
        - Verify that the ORM models in `models/conversation.py` and (once available) `models/message.py` perfectly match the final database schema.

---

### 4. Implementation Rationale

Following this detailed, file-specific plan will ensure that your implementation aligns with your goals:

- **Maintainability:** By making changes in the correct, existing modules (e.g., `ConversationService` for backend logic, `ChatManager` in `chat.js` for frontend orchestration, `models/conversation.py` for data structure), you leverage the existing architecture. Consolidating chat to be project-centric and cleaning up legacy code reduces complexity. Storing model configs as direct columns improves type safety and queryability over JSON blobs.
- **User Experience:** Features like live token counts, explicit model configuration per chat, inline message controls (copy, retry), and clear citation for RAG outputs directly enhance user interaction and control.
- **Robustness:** Precise server-side token counting and context window truncation (as outlined for `ConversationService`) will prevent errors from exceeding model limits. Storing raw and formatted message text separately prevents data loss and rendering issues.
- **Consistency:** Applying these changes systematically across the model, service, route, and frontend layers will ensure data integrity and a cohesive feature set, as envisioned in your plan and supported by the structure indicated in `README.md`.

This customized instruction set should guide you in effectively integrating your planned features into the `henryperkins/azure_chatapp` application. Remember to test each component thoroughly.

---

# Custom Azure ChatApp 7-Step Guide
_A file-by-file blueprint for refactoring `henryperkins/azure_chatapp` into a unified, project-centric chat experience with full token-window enforcement, model switching, and RAG._

---

## 📑 Quick Index
1. Database + Models
2. Service Layer
3. API Routes & Validation
4. Context / Token Management
5. Front-End (JS modules & HTML)
6. RAG & Web Search Integration
7. Cleanup & Migrations

---

## 1  Database & Models

| Change | File(s) | Details |
|-------|---------|---------|
| Extend Conversation | `models/conversation.py` | • Add `model_config` JSONB (stores per-conversation config snapshot)<br>• Add `context_token_usage` INT (rolling total)<br>• Rename `use_knowledge_base` → `kb_enabled` for clarity |
| Message raw & formatted | `models/message.py` | • Add `rendered_html` TEXT (server-side Markdown render)<br>• Add `token_count` INT _per message_ |
| Migration | Alembic scripts (`versions/*.py`) | • Generate with `alembic revision --autogenerate -m "conversation model_config"` |
| Indices | DB migrations | • Composite index `(conversation_id, created_at)` for message fetch<br>• GIN index on `model_config` if you query JSONB |

---

## 2  Service Layer

### 2.1 `services/conversation_service.py`
- Inject `ContextManager` (new helper) for every `create_message`.
- On user messages:
  1. Persist message → flush.
  2. `ContextManager.build_prompt(...)` → returns truncated+KB-augmented `messages`.
  3. Call `generate_ai_response(...)`.
  4. Persist assistant reply (incl. `rendered_html`, `token_count`).
  5. Update `conversation.context_token_usage`.

### 2.2 `services/context_manager.py` (NEW)
```python
class ContextManager:
    def __init__(self, db: AsyncSession, model_id: str):
        self.db = db
        self.model_id = model_id

    async def build_prompt(
        self,
        conversation: Conversation,
        incoming_user_text: str,
    ) -> list[dict[str, str]]:
        history = await self._load_history(conversation.id)
        history = await manage_context(history)          # token limit guard
        kb_msgs = await augment_with_knowledge(
            conversation.id, incoming_user_text, self.db
        )
        return kb_msgs + history + [{"role": "user", "content": incoming_user_text}]
```
- Guarantees prompt ≤ model’s hard context (`model_config["max_ctx"]`).

### 2.3 `utils/message_render.py` (NEW)
- Converts Markdown → sanitized HTML (for inline code‐block rendering).

---

## 3  API Routes & Validation

### 3.1 `routes/unified_conversations.py`
- **POST /{project_id}/conversations**: accept optional `model_config` payload.
- **PATCH .../conversations/{id}**: allow title, model switch, delete.
- **POST .../messages**: forward new `enable_thinking`, `reasoning_effort`, `temperature`, images.
- Add FastAPI `Depends(validate_model_and_params)` to reject invalid configs early.

### 3.2 `utils/validators.py` (NEW)
```python
def validate_model_and_params(model_id: str, cfg: dict):
    allowed = get_model_config(model_id)
    if not allowed:
        raise HTTPException(400, f"Unknown model {model_id}")
    # e.g. temperature bounds, token budget <= allowed["maxTokens"]
```

---

## 4  Context / Token Management

| Concern | Implementation |
|---------|----------------|
| Live token count | `estimate_token_count()` already in [[context]] – call it after every message and push to frontend via WebSocket event `"token_stats"` |
| Hard limit | `manage_context()` (already present) now uses `get_model_config(model_id)["max_ctx"]` rather than constant 3 000. |
| Surfaced to user | `ChatManager._showTokenStats({ used, max })` – renders a small badge next to input (“1 432 / 8 192 tok”). |

---

## 5  Front-End

### 5.1 `static/js/modelConfig.js`
- Extend state: `temperature`, `reasoningEffort`, `reasoningSummary`, `thinkingBudget`.
- Dispatch `modelConfigChanged` with full config object.
- Store in localStorage keys prefixed with `mc:` to avoid collision.

### 5.2 `static/js/chat.js` (`ChatManager`)
1. **Initialization**
   ```js
   const cfg = this.modelConfigAPI.getConfig();
   this.currentModelConfig = cfg;
   ```
2. **Send Flow**
   - Include `cfg` fields in message payload (already partially done).
   - Listen for `token_stats` event → update UI.
3. **Inline Controls** (per message)
   - On hover, show 3-dot menu: _Copy · Retry · Delete_.
   - Use `eventHandlers.trackListener` to register.

### 5.3 `static/html/project_details.html`
- Already contains chat scaffolding.
- Add `<span id="tokenUsageBadge"></span>` inside input row.

### 5.4 Markdown & Code Rendering
- Replace manual `DOMPurify` calls with new helper:
  ```js
  import { renderMarkdown } from "./markdownRenderer.js";
  contentEl.innerHTML = renderMarkdown(raw, { sanitize: DOMPurify });
  ```

---

## 6  RAG & Web Search

| Task | File(s) | Notes |
|------|---------|-------|
| Citation formatting | `utils/ai_helper.retrieve_knowledge_context` already returns `[Source X: …]`. Keep. |
| Web search fallback | Add `services/web_search_service.py` (wrap Bing or SerpAPI). |
| Prompt stitching | In `ContextManager.build_prompt()`, if no KB hits and `model_config.webSearch=true`, call `web_search_service.search(query)` and prepend result summaries. |
| UI toggle | Add checkbox “Web search fallback” in sidebar Model Config. |

---

## 7  Cleanup & Migrations

1. Delete legacy standalone chat routes (`routes/chat_routes.py`) and templates (`static/html/chat.html`).
2. Remove unused `static/js/chat_standalone.js` and references in `base.html`.
3. Run Alembic migration, then:
   ```bash
   uvicorn main:app --reload  # verify schema
   npm run dev                # verify front-end
   ```
4. Update README deployment section to mention `tiktoken`, new env vars (`WEB_SEARCH_API_KEY`, etc.).

---

## ✅ Next Steps / Checklist

- [ ] Write & run Alembic migrations
- [ ] Implement `ContextManager` + unit tests
- [ ] Extend `ConversationService.create_message()` flow
- [ ] Finish Model Config UI (sidebar)
- [ ] Add token badge rendering in ChatManager
- [ ] Regression-test KB search & citations
- [ ] Remove deprecated files / routes
- [ ] Update docs & screenshots in README

---

**Tip:** Use feature flags (`settings.ENABLE_WEB_SEARCH`) in `config.py` so new functionality can be toggled in staging versus production.
