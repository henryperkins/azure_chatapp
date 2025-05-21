# 🛡️ Python Backend Code Guardrails

These guidelines strictly apply to all Python backend development, maintenance, and AI-assisted code generation within this project. They ensure consistency, maintainability, performance, and security across the application.

1. Application Structure
	•	FastAPI Initialization: Defined explicitly in main.py. Routers (APIRouter) must be modularized (e.g., unified_conversations.py, knowledge_base_routes.py).
	•	Route Handlers: Must be thin; delegate logic to service modules.
	•	Response Models: Clearly defined using Pydantic schemas.

2. Dependency Injection (DI)
	•	Explicitly inject dependencies using FastAPI’s Depends().
	•	Avoid global state or module-level singletons.
	•	Utilize factory functions (e.g., in context_manager.py) for complex dependency resolution.

3. Services and Business Logic
	•	Services: Clearly isolated, no route logic directly inside (project_service.py, ai_response.py).
	•	Services must not directly manage HTTP responses; raise exceptions or return plain data structures.

4. Database Management
	•	Use asynchronous SQLAlchemy ORM through utility patterns (db_utils.py).
	•	Keep database logic confined strictly within service or repository modules.

5. Authentication & Security
	•	Cookie-based sessions preferred (auth.py, auth_utils.py).
	•	Validate all user/session claims explicitly; never trust client-supplied IDs.
	•	Security-sensitive code must clearly delineate authorization and authentication responsibilities.

6. Configuration Handling
	•	Leverage environment-driven configuration via Pydantic BaseSettings (config.py).
	•	No hard-coded sensitive values (keys, secrets) within code.

7. Logging and Monitoring
	•	Use structured logging provided by injected loggers (logs.py, logging_config.py).
	•	Logs must contain contextual metadata (request IDs, user IDs).
	•	Integrate with Sentry (sentry_utils.py, mcp_sentry.py) for comprehensive exception capturing.

8. Validation and Serialization
	•	Pydantic models mandatory for validation and serialization (serializers.py).
	•	Enforce strict schema validation for all input and output models.

9. Background and Long-Running Tasks
	•	Background tasks (embedding, file validation, extraction) handled by dedicated modules (file_validation.py, text_extraction.py).
	•	Tasks queued via services, never directly in route handlers.

10. External Integrations
	•	Interactions with external services (e.g., OpenAI APIs) must reside in dedicated client modules (openai.py).
	•	Abstract external service errors into application-specific exceptions.

11. Utility Modules
	•	**Import-time side-effects & module-level config**: Utilities must be import-safe—no environment reads, I/O or HTTP calls, or thrown exceptions at import-time. Move all thresholds, endpoints, keys, and flags into `config.py` and inject them via DI or function parameters.
	•	**No module-level state**: Remove global constants derived from env/settings (e.g., `retry.py`’s `MAX_RETRIES`, `RETRY_DELAY`; `openai.py`’s sample-rate constants; `file_validation.py`’s size limits; `response_utils.py`’s endpoint constants). Instead, define configuration in Pydantic settings and inject at runtime.
	•	**Async-friendly, non-blocking design**: Avoid blocking calls (`time.sleep`, sync file I/O in `io_utils`, etc.) in async code paths. Use `asyncio.sleep`, `aiofiles`, thread-pool offloads, or dedicated async retry wrappers.
	•	**Centralized retry logic & HTTP client use**: Leverage the shared retry utilities (`retry.py` sync & async) for retry patterns. Use a DI-provided or factory-scoped `httpx.AsyncClient` for all outgoing HTTP calls rather than creating ad-hoc clients.
	•	**Explicit dependency injection**: Eliminate hidden dependencies and global imports. Inject all external dependencies (DB sessions via `Depends()`, loggers, settings, HTTP clients, etc.) explicitly through function parameters or factories.
	•	**Error handling & separation from HTTP concerns**: Utilities should return plain data or raise application-specific exceptions. They must not construct FastAPI responses. All errors should be logged through the injected logger with contextual metadata.
	•	**Security & sanitization**: Enforce strict input/output sanitization in file/HTML utilities—use path-safe filename handling, content-scan thresholds, XSS protection with explicit bleach allowlists, and size/content limits driven by config.

12. Middleware
	•	Middleware logic must reside in dedicated modules (middlewares.py).
	•	Middleware responsibilities clearly scoped and documented.
	•	Avoid complex business logic; middleware should strictly manage cross-cutting concerns (logging, monitoring, request handling).

13. Testing
	•	Write comprehensive async tests using pytest.
	•	Service-layer functions must remain easily testable by mocking dependencies through factories.

14. Performance
	•	Enforce consistent usage of async/await.
	•	Avoid synchronous or blocking calls in the async code paths.
	•	Optimize database queries to avoid N+1 and inefficient joins.

Strict adherence to these guardrails ensures a secure, maintainable, and scalable backend environment.