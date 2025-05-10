# Disable Sentry SqlalchemyIntegration for Async Engine Compatibility

**Date:** 2025-05-09
**Author:** Roo

## Background
A recent spike of `HTTP 500` errors during conversation creation revealed the following runtime exception:

```text
RuntimeError: greenlet_spawn has not been called; can't call await_only() here. Was IO attempted in an unexpected place?
```

The stack-trace originates inside `sentry_sdk.integrations.sqlalchemy.SqlalchemyIntegration`, which assumes the synchronous SQLAlchemy engine. When our application uses `AsyncSession`, the integration performs blocking IO outside a greenlet, triggering the guard.

## Impact
* Conversation creation fails (route `POST /{project_id}/conversations`) with **500 Internal Server Error**.
* Multiple ERROR entries flood the logs and Sentry.
* All features depending on new conversations are blocked.

## Root Cause
`SqlalchemyIntegration` subscribes to SQLAlchemy engine events globally. When the first DB span for a transaction attempts to access the async engine, the sync code path calls `await_only()` in a non-greenlet context, causing the `greenlet_spawn` assertion.

## Decision
Temporarily **disable `SqlalchemyIntegration`** until an async-safe version is available.

We introduce a new configuration flag to control this:

* **Environment variable:** `SENTRY_SQLA_ASYNC_ENABLED` (default `false`)
* **Config setting:** `settings.SENTRY_SQLA_ASYNC_ENABLED` (overrides env)

When the flag is **false** the integration is omitted from the `sentry_sdk.init()` call.

## Implementation Steps
1. Update `utils/sentry_utils.configure_sentry`:
   * Read the flag (`settings` first, else `os.getenv`).
   * Append `SqlalchemyIntegration()` to the `integrations` list **only when enabled**.
   * Log `INFO "SqlalchemyIntegration disabled for async engine compatibility"` when skipped.
2. Update `config.py` with default flag value `False` and env-var binding.
3. Update **README / docs** (this file) to document the flag and migration notes.

## Deployment / Roll-out
1. Merge the code changes.
2. Deploy to staging and execute conversation creation flow; verify **no** `greenlet_spawn` exceptions.
3. Deploy to production.

### Verification Checklist
- [ ] Conversation creation returns **201**.
- [ ] Log stream free of `greenlet_spawn` RuntimeErrors.
- [ ] Sentry still ingests FastAPI traces and error events.

## Rollback Plan
Set `SENTRY_SQLA_ASYNC_ENABLED=true` in the env or revert commit to restore previous behaviour (re-introduces risk).

## References
* SQLAlchemy async greenlet docs: <https://sqlalche.me/e/20/xd2s>
* Sentry SDK issue tracker: [link-to-upstream-issue]
