# Logging Guidelines

---

## Purpose

This document defines conventions and requirements for all logging instrumentation across backend (Python/FastAPI) and frontend (JavaScript/Browser) code. Its goals:
- Prevent missing or inconsistent logs.
- Guarantee traceability across layers.
- Enforce one-time logger configuration.
- Provide full-stack, correlated diagnostic capability.

---

## Logger Naming (Canonical)

- **Python:**
  Use:
  ```python
  logger = logging.getLogger(f"app.<layer>.<module>")
  ```
  - Example: `app.api.user`, `app.services.project`
  - `logger = logging.getLogger(__name__)` is only permitted if `__name__` expands to the required format (must start with `app.`).
  - Custom logger names (e.g. "audit") must be explicitly registered in code and documented.

- **JavaScript:**
  Use via factory and DI only. Naming follows:
  ```
  context = "app.<layer>.<file>"
  ```
  - Example: `app.ui.sidebar`, `app.utils.apiClient`
  - Never use direct `console.*` calls in modules (except as emergency in global error handler before DI is ready).
  - Never create local/fallback/noop logger objects. Logger must be injected or retrieved from DependencySystem DI.

---

## Log Levels (Unified)

All logs — both backend and frontend — must use and map exactly these levels:

| Level     | Python           | JS/Frontend      |
|-----------|------------------|-----------------|
| DEBUG     | `logging.DEBUG`  | `logger.debug`  |
| INFO      | `logging.INFO`   | `logger.info`   |
| WARNING   | `logging.WARNING`| `logger.warn`   |
| ERROR     | `logging.ERROR`  | `logger.error`  |
| CRITICAL  | `logging.CRITICAL` | `logger.error`/`logger.critical` |

- No custom levels or aliases allowed.
- Levels must be controlled globally via:
  - **Python:** Environment (`LOG_LEVEL`) or config object on startup.
  - **JS:** `APP_CONFIG.LOG_LEVEL`, persisted and settable via UI.

---

## Correlation ID Propagation

- Every backend/API response must emit a request correlation ID in the `X-Request-Id` HTTP response header.
- All frontend-initiated API requests *must* forward any known `X-Request-Id` as an outgoing header.
- All log records (backend and frontend) *must* include the current correlation/request ID:
  - **Python:** Use ContextVar for request id; attached by FastAPI dependency/middleware and all log filters/formatters.
  - **JS:** Logger factory must pull correlation/request ID from `window.__REQUEST_ID__` or from last known API response. Include field as `requestId` in log meta each time.

---

## One-time Configuration Rule

- **Python:**
  All log config, handlers, filters, and formatters *must only* be set up via `utils.logging_config.init_logging(config=None)`.
  - Call this at the absolute top of `main.py` and any script entry point (before importing any local modules).
  - Never call `logging.basicConfig()` except in `utils/logging_config.py`.

- **JavaScript:**
  The canonical logger factory (`createLogger`) and `globalLogger` are exported from `static/js/logger.js`.
  - Logger is registered once early (`app.js`) and injected by DI everywhere else.
  - Never use or define alternate logger objects (no stubs, no fallback winConsole etc.).
  - All modules must require logger as dependency and throw if not available.

---

## CI/Lint Enforcement

- **Flake8**:
  - Enforce no `basicConfig` outside `utils/logging_config.py`.
  - Enforce logger name begins with `app.`.
- **ESLint**:
  - Enforce all logger construction and injection via factory; no fallback loggers, only DI.

---

## Other Required Practices

- All logs must be output in structured JSON for server ingestion and colored text for interactive terminals (Python).
- All sensitive/PPI data in logs must be filtered (using filters in backend, sanitization in frontend as needed).
- Never silence/ignore logger errors; always throw or visibly fail if logger setup is missing.
- All changes to logging configuration must be reflected in this document and referenced in commit messages.

---

_Last updated: May 2025_
