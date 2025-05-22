"""
utils/sentry_config.py
----------------------
Sentry configuration and filter logic.
"""

import os
import logging
from typing import Any, Optional
import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.types import Event, Hint

NOISY_LOGGERS = {
    "uvicorn.access",
    "uvicorn.error",
    "fastapi",
    "asyncio",
    "sqlalchemy.engine.Engine",
    "sqlalchemy.pool",
    "urllib3.connectionpool",
    "requests",
    "httpx",
}
SENSITIVE_KEYS = {
    "password",
    "token",
    "secret",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "session",
}
IGNORED_TRANSACTIONS = {
    "/health",
    "/metrics",
    "/favicon.ico",
    "/robots.txt",
    "/static/",
    "/api/auth/csrf",
    "/api/auth/verify",
}

def _filter_request_data(request_data: dict[str, Any]) -> None:
    if isinstance((payload := request_data.get("data")), dict):
        for k in list(payload):
            if any(s in k.lower() for s in SENSITIVE_KEYS):
                payload[k] = "[FILTERED]"
    if isinstance((headers := request_data.get("headers")), dict):
        request_data["headers"] = {
            k: ("[FILTERED]" if any(s in k.lower() for s in SENSITIVE_KEYS) else v)
            for k, v in headers.items()
        }

def _filter_user_data(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "ip_address": user.get("ip_address"),
    }

def _filter_contexts(contexts: dict[str, Any]) -> dict[str, Any]:
    return {
        k: ("[FILTERED]" if any(s in k.lower() for s in SENSITIVE_KEYS) else v)
        for k, v in contexts.items()
    }

def _filter_event(event: Event) -> Event:
    if "request" in event:
        _filter_request_data(event["request"])  # type: ignore[arg-type]
    if "user" in event:
        event["user"] = _filter_user_data(event["user"])  # type: ignore[arg-type]
    if "contexts" in event:
        event["contexts"] = _filter_contexts(event["contexts"])  # type: ignore[arg-type]
    return event

def filter_sensitive_event(event: Event, hint: Optional[Hint] = None) -> Optional[Event]:
    if event.get("type") == "transaction":
        url = str(event.get("request", {}).get("url", ""))
        if any(p in url for p in IGNORED_TRANSACTIONS):
            return None
    try:
        import psutil
        mem_mb = psutil.Process().memory_info().rss / 1024 / 1024  # type: ignore[attr-defined]
        event.setdefault("extra", {}).update({"memory_usage_mb": round(mem_mb, 1)})
    except Exception:
        pass
    return _filter_event(event)

def _ignore_noisy_loggers() -> None:
    for logger_name in NOISY_LOGGERS:
        ignore_logger(logger_name)

def configure_sentry(
    *,
    dsn: str,
    environment: str = "production",
    release: str | None = None,
    traces_sample_rate: float = 0.2,
    profiles_sample_rate: float | None = None,
    enable_sqlalchemy: bool | None = None,
) -> None:
    if str(os.getenv("SENTRY_ENABLED", "")).lower() not in {"1", "true", "yes"}:
        logging.info("Sentry disabled via env flag; skipping initialisation.")
        return

    sentry_logging = LoggingIntegration(
        level=logging.WARNING,
        event_level=logging.ERROR,
    )

    integrations = [
        sentry_logging,
        FastApiIntegration(transaction_style="endpoint"),
        AsyncioIntegration(),
    ]

    sql_flag = (
        enable_sqlalchemy
        if enable_sqlalchemy is not None
        else str(os.getenv("SENTRY_SQLA_ASYNC_ENABLED", "false")).lower() in {"1", "true"}
    )
    if sql_flag:
        integrations.append(SqlalchemyIntegration())
        logging.info("Sentry SqlAlchemy integration enabled.")
    else:
        logging.info("Sentry SqlAlchemy integration disabled.")

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        integrations=integrations,
        default_integrations=False,
        before_send=filter_sensitive_event,
        debug=str(os.getenv("SENTRY_DEBUG", "")).lower() in {"1", "true", "yes"},
        send_default_pii=False,
    )

    _ignore_noisy_loggers()
    logging.info("Sentry initialised (%s)", environment)
