# 🛡️ Unified Code Guardrails

These guidelines apply strictly to **all** backend (Python/FastAPI) and frontend (JavaScript/TypeScript) development, maintenance, and AI-assisted code generation within this project. They ensure consistency, maintainability, performance, and security throughout the codebase.

---

## 📌 Table of Contents

1. [General Principles](#general-principles)
2. [Python Backend Code Guardrails](#python-backend-code-guardrails)
3. [Frontend Code Guardrails](#frontend-code-guardrails)
4. [🚩 Universal Red-Flag Checklist](#universal-red-flag-checklist)

---

## 🚧 General Principles

* **Dependency Injection Everywhere** – Inject all dependencies explicitly; avoid hidden globals.
* **Thin Boundaries** – Keep routes/controllers lightweight; delegate business logic to dedicated services.
* **Side-Effect-Free Imports** – No I/O, network calls, or heavy computations at import time.
* **Structured Logging & Observability** – JSON-formatted logs with contextual metadata; avoid plain `print()` or `console.*` calls.
* **Security First** – Validate all inputs, sanitize all outputs, enforce least privilege.
* **Async Consistency** – Maintain async/await consistency; never mix synchronous, blocking calls.
* **Fail Fast & Loud** – Surface errors quickly with descriptive contextual logs; no silent failures.

---

## 🐍 Python Backend Code Guardrails

> **Scope**: FastAPI applications using async SQLAlchemy and PostgreSQL.

### Application Structure

* **FastAPI Initialization**

  * ✅ Define explicitly in `main.py`.
  * ✅ Modularize routes using domain-specific `APIRouter` modules.
  * ❌ Avoid declaring routes directly in `main.py` or mixing unrelated routes in one file.

* **Route Handlers (Thin Controllers)**

  * ✅ Limit handlers to request validation, delegation, and response formatting.
  * ❌ Avoid DB queries or business logic inside handlers.

* **Response Models**

  * ✅ Use specific Pydantic models.
  * ❌ Avoid generic or ambiguous responses (`dict`, `Any`).

* **Package Organization**

  * ✅ Keep `__init__.py` minimal.
  * ❌ Avoid complex logic or side-effect imports in package inits.

### Dependency Injection

* ✅ Use explicit DI with FastAPI’s `Depends()`, constructor parameters, and factory methods.
* ✅ Defer resource-heavy initialization to DI or lifecycle events; never at module top.

### Services & Business Logic

* ✅ Domain-specific service modules; encapsulate all logic and raise domain-specific exceptions.
* ❌ Never raise FastAPI `HTTPException` directly from services.

### Database Management

* ✅ Exclusively use asynchronous SQLAlchemy.
* ✅ Confine queries strictly within service layers.
* ✅ Optimize queries using eager loading techniques (`selectinload`, `joinedload`); address N+1 issues proactively.

### Authentication & Security

* ✅ Implement secure cookie attributes (`HttpOnly`, `Secure`), enforce CSRF protection.
* ✅ Separate clearly authentication and authorization logic.

### Configuration Management

* ✅ Configure settings using Pydantic’s `BaseSettings` class sourced from environment variables.
* ✅ Inject settings explicitly via DI.

### Logging & Monitoring

* ✅ Structured JSON logs; include contextual metadata (request ID, user ID).
* ✅ Integrate error monitoring tools (e.g., Sentry).

### Validation & Serialization

* ✅ Use Pydantic consistently for all request/response validation; enforce strict schema validation.

### Background & Long-Running Tasks

* ✅ Move intensive tasks to Celery or FastAPI’s `BackgroundTasks`; include robust tracking and idempotency.

### External Integrations

* ✅ Encapsulate external APIs within dedicated client modules; handle retries and translate errors internally.

### Utility Modules & Shared Code

* ✅ Ensure modules are import-safe (no side effects at import time).
* ✅ Load heavy resources lazily; perform all I/O asynchronously (via `httpx.AsyncClient`, `aiofiles`).

### Middleware

* ✅ Restrict middleware to cross-cutting concerns (logging, auth); no business logic.

### Testing

* ✅ Write comprehensive async-compatible tests using `pytest` and `pytest-asyncio`.
* ✅ Leverage dependency overrides for isolation and accuracy in integration tests.

### Performance

* ✅ Ensure async consistency throughout; properly pool resources and connections.
* ✅ Regularly monitor and optimize query performance.

### Code Duplication (DRY Principle)

* ✅ Abstract repeated logic into reusable utilities; prioritize composition over inheritance.

---

## ⚛️ Frontend Code Guardrails

> **MOST IMPORTANT RULE:**
> **DO NOT, UNDER ANY CIRCUMSTANCES, CREATE A NEW MODULE FOR ANY REASON.**

* **Factory Function Export** – Export via named factories (`createXyz`); avoid top-level execution.
* **Strict Dependency Injection** – No direct globals (`window`, `document`, `console`); only use DI abstractions.
* **Pure Imports** – Ensure no side effects at import time.
* **Centralized Event Handling** – Register listeners using central handlers (`eventHandlers.trackListener`).
* **Context Tags** – Provide a unique context tag for each listener.
* **Sanitize User HTML** – Always sanitize via `sanitizer.sanitize()` before DOM insertion.
* **DOM Readiness (Mandatory)** – Use DI-provided `domReadinessService`; never ad-hoc readiness checks.
* **Centralized State Access** – Access global state via `app.state`; never mutate it directly.
* **Module Event Bus** – Use dedicated `EventTarget` instances for module events.
* **Navigation Service** – Route all URL/navigation changes through injected `navigationService.navigateTo`.
* **Single API Client** – Centralize API requests via injected `apiClient`.

### 🚨 Logging & Observability

* **Logger Usage** – Exclusively use DI-provided `logger`; no direct `console.*` calls.
* **Structured Logging** – Report errors with context and stack traces.
* **Logger Implementation** – Structured logs sent to server endpoint (`/api/logs`); include rich metadata.

**Error Handling Pattern:**

```javascript
function safeHandler(handler, description) {
  return (...args) => {
    try {
      return handler(...args);
    } catch (err) {
      logger.error(`[${description}]`, err.stack || err);
      throw err;
    }
  };
}
```

---

## 🚩 Universal Red-Flag Checklist

Actively detect and eliminate these anti-patterns:

* Direct database queries in route handlers.
* Business logic outside dedicated service layers.
* Generic response types in FastAPI routes (`dict`, `Any`).
* Blocking synchronous operations in async paths.
* Resource-heavy initializations at module-level scope.
* Direct imports of global configuration or settings.
* Services directly raising `HTTPException`.
* Mutable state at module-level without proper management.
* Missing contextual details in logs or error reports.
* Silent, unlogged exceptions.
* Hard-coded sensitive configuration values.

**Frontend-specific anti-patterns:**

* Adding new modules without approval.
* Using `console.*` for logging.
* DOM readiness checks performed outside `domReadinessService`.
* Direct DOM manipulation without sanitization.
* Missing context tags for event listeners.

---

**Reminder:** These guardrails are mandatory. All code must comply, and any violation must be flagged clearly with a corrective proposal.
