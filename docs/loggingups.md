**Core Goal**: Make backend logs (terminal output) structured and informative, ensure Sentry receives rich context for errors and breadcrumbs, and fix direct causes of confusing or suppressed errors.

**Phase 1: Structured Backend Logging (for Terminal & Sentry Breadcrumbs)**

1.  **Create `utils/logging_config.py`**:
    *   This file will set up structured JSON logging for your terminal output. This also benefits Sentry as its SDK can pick up these structured logs as breadcrumbs.
    *   We'll use `python-json-logger` as you initially proposed.
    *   **`ContextFilter`**: A small filter class will be added here. Its job is to grab `request_id` and `trace_id` (which will be set by a middleware) from `contextvars` and add them to every log record.
    *   **`CustomJsonFormatter`**: This class (similar to your proposal) will format log records into JSON. It will ensure key fields like `timestamp`, `level`, `message`, `request_id`, `trace_id`, and any fields you pass in `extra` (like `user_id`) are present in the JSON output.
    *   **`init_structured_logging()` function**: This function will:
        *   Set the root logger's level (e.g., to `INFO` by default, configurable via `LOG_LEVEL` env var).
        *   Clear any existing handlers to avoid duplicate logs.
        *   Add a `StreamHandler` to output logs to your terminal (`sys.stdout`).
        *   Attach the `ContextFilter` and `CustomJsonFormatter` to this handler.

2.  **Update `utils/middlewares.py`**:
    *   Define `request_id_var: ContextVar[str]` and `trace_id_var: ContextVar[str]`.
    *   In your existing `request_id_logging_middleware` (or a similar middleware), when a request comes in:
        *   Generate/get the `request_id` and set `request_id_var.set(request_id)`.
        *   Get the `trace_id` (e.g., from `sentry_sdk.get_traceparent()`) and set `trace_id_var.set(trace_id)`.

3.  **Modify `main.py`**:
    *   At the very beginning of your application startup, call `init_structured_logging()` from `utils.logging_config`.

4.  **Update `requirements.txt`**:
    *   Add `python-json-logger`.

5.  **Logging Practice**:
    *   When you log messages, e.g., `logger.info("User logged in", extra={"user_id": user.id})`, the `user_id` will be automatically included in the structured JSON log by the `CustomJsonFormatter`.

**Phase 2: Debugging & Async Fixes (Clearer Error Reporting)**

1.  **Fix `asyncio.run` Misuse (as per your `utils/sentry_utils.py` example)**:
    *   Refactor functions like `_get_active_conversations_count` to be properly `async` (`async def`) and `await` calls to them. This prevents `RuntimeError`s that can hide the actual problem.

2.  **Replace Blocking Calls**:
    *   Change `time.sleep(0.1)` to `await asyncio.sleep(0.1)` in your FastAPI async route handlers. This stops the event loop from being blocked, leading to more predictable behavior and clearer performance traces if issues arise.

3.  **Handle `except Exception: pass` Blocks**:
    *   Review these. Instead of silently passing, at least log the exception: `logging.error("An error occurred in X", exc_info=True)`. This makes sure errors aren't silently ignored, which is crucial for troubleshooting. Sentry will also pick these up.

**Phase 3: Sentry Optimizations (Better Alerts & Less Noise)**

1.  **Sentry Log Levels for Breadcrumbs**:
    *   Sentry's logging integration typically captures `INFO` level logs as breadcrumbs by default. Since `init_structured_logging` will likely set your root logger to `INFO`, this should work well. Your `SuppressUnwantedLogsFilter` will still be respected.

2.  **Reduce Double Reporting to Sentry**:
    *   Investigate and fix the issue where FastAPI `HTTPException`s (status >= 500) are reported twice. This might involve adjusting Sentry's FastAPI integration settings or adding a check in your error handling logic.

**What this gives you:**

*   **Clearer Terminal Logs**: Your terminal output will be structured JSON, with `request_id` and `trace_id` on every relevant log line, making it much easier to follow the lifecycle of a request.
*   **Better Sentry Breadcrumbs**: Sentry will receive these structured logs as breadcrumbs, providing richer context when an error occurs.
*   **More Reliable Error Reporting**: Fixing `asyncio.run` issues and un-silencing `except Exception: pass` blocks means actual errors are reported to Sentry with proper stack traces.
*   **Less Alert Fatigue**: Fixing double reporting will make Sentry alerts more targeted.

This plan avoids adding new systems and focuses on making your existing tools (terminal, Sentry) work better for you.
