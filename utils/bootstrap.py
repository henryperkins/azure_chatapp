"""
utils/bootstrap.py
─────────────────────────────────────────────────────────────────────────
Single source of truth for all observability and telemetry initialization.

This module consolidates structured logging and Sentry configuration to ensure:
1. Consistent initialization order (logging first, then Sentry)
2. No duplicate bootstraps or competing configurations
3. Proper context propagation between logging and tracing systems
4. Environment-aware sampling and filtering

Usage:
    from utils.bootstrap import init_telemetry
    init_telemetry()  # Call once at application startup, before any other logging
"""

import os
import logging
from typing import Optional

def init_telemetry(
    app_name: Optional[str] = None,
    app_version: Optional[str] = None,
    environment: Optional[str] = None,
    sentry_dsn: Optional[str] = None
) -> None:
    """
    Initialize all telemetry systems in the correct order.

    Args:
        app_name: Application name for Sentry release tag (defaults to env var)
        app_version: Application version for Sentry release (defaults to env var)
        environment: Environment name (defaults to env var, fallback to 'production')
        sentry_dsn: Sentry DSN (defaults to env var)
    """
    # 1️⃣ ALWAYS initialize structured logging first
    from utils.logging_config import init_structured_logging
    init_structured_logging()

    logger = logging.getLogger(__name__)
    logger.info("Structured JSON logging initialized")

    # 2️⃣ Then initialize Sentry (respects SENTRY_ENABLED env var)
    from utils.sentry_utils import configure_sentry

    # Use provided values or fall back to environment variables
    app_name = app_name or os.getenv("APP_NAME", "azure_chatapp")
    app_version = app_version or os.getenv("APP_VERSION", "unknown")
    environment = environment or os.getenv("ENVIRONMENT", "production")
    sentry_dsn = sentry_dsn or os.getenv("SENTRY_DSN", "")

    # Environment-aware sampling rates
    if environment == "production":
        traces_sample_rate = 0.1      # 10% in production
        profiles_sample_rate = 0.0    # Disable expensive profiling
    elif environment == "staging":
        traces_sample_rate = 0.3      # 30% in staging
        profiles_sample_rate = 0.0
    else:
        traces_sample_rate = 0.02     # 2% in development
        profiles_sample_rate = 0.0

    # Build release string
    release = f"{app_name}@{app_version}" if app_version != "unknown" else app_name

    configure_sentry(
        dsn=sentry_dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        enable_sqlalchemy=False  # Keep disabled for async safety
    )

    logger.info("Telemetry initialization complete", extra={
        "app_name": app_name,
        "app_version": app_version,
        "environment": environment,
        "sentry_enabled": bool(sentry_dsn and os.getenv("SENTRY_ENABLED", "").lower() in {"1", "true", "yes"}),
        "traces_sample_rate": traces_sample_rate
    })
