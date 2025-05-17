"""
Application Configuration Module (config.py)
--------------------------------------------

Centralized runtime configuration for the application, sourced from environment variables and `.env` files.
Provides settings for database connectivity, SSL and security policies, session/cookie parameters,
model provider API keys, CORS rules, and feature toggles affecting schema, migration, and authentication routines.

Highlights:
- Supplies `DATABASE_URL`, SSL and migration variables—vital for all schema/ORM/database features.
- Manages environment-specific flags for debug, production, and relaxed/insecure operation.
- All settings exposed via the `settings` object for use throughout the app, including DB connection,
  migration, CORS/session config, and integration with external API providers (OpenAI, Azure, Anthropic, etc).
- Intended for local development, testing, or as a template for secure production configs.

Best practice: Set desired config in `.env`, and let this module load everything for the rest of your stack.
NEVER use the insecure defaults in production!

"""

import os
from dotenv import load_dotenv
from typing import Any
from pathlib import Path
from urllib.parse import quote_plus

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)


VECTOR_DB_STORAGE_PATH = "./storage/vector_db"


class Settings:
    """
    Insecure / Debug Configuration Class

    Security Principles (RELAXED):
    1. CORS allowed from all or multiple domains.
    2. Cookie security relaxed:
       - SameSite=None or Lax (instead of Strict)
       - Secure flag not enforced (HTTP allowed)
       - HttpOnly still recommended but not strictly enforced
    3. Cross-domain usage of tokens/JWT is possible (no strict domain checks).
    4. All API access can occur over HTTP. This is insecure, only for local dev!
    """

    # Application Version
    APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
    APP_NAME = os.getenv("APP_NAME", "azure-chatapp")  # Added APP_NAME

    # Debug/Environment
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"
    ENV = os.getenv("ENV", "development")  # Force 'development' for insecure mode

    # Sentry Configuration (still optional in debug)
    SENTRY_DSN = os.getenv("SENTRY_DSN", "")
    SENTRY_ENABLED = os.getenv("SENTRY_ENABLED", "False").lower() == "true"
    SENTRY_TRACES_SAMPLE_RATE = float(
        os.getenv("SENTRY_TRACES_SAMPLE_RATE", "1.0")
    )  # high for debug
    SENTRY_PROFILES_SAMPLE_RATE = float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "1.0"))
    SENTRY_REPLAY_SESSION_SAMPLE_RATE = float(
        os.getenv("SENTRY_REPLAY_SESSION_SAMPLE_RATE", "1.0")
    )
    SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE = float(
        os.getenv("SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE", "1.0")
    )
    SENTRY_MCP_SERVER_ENABLED = (
        os.getenv("SENTRY_MCP_SERVER_ENABLED", "False").lower() == "true"
    )
    SENTRY_MCP_SERVER_URL = os.getenv("SENTRY_MCP_SERVER_URL", "http://localhost:8001")
    SENTRY_SQLA_ASYNC_ENABLED = (
        os.getenv("SENTRY_SQLA_ASYNC_ENABLED", "False").lower() == "true"
    )

    # Session secret (insecure default)
    SESSION_SECRET = os.getenv("SESSION_SECRET", "dev_insecure_key")

    # PostgreSQL connection: either full URL or separate PG* variables (preferred for Azure)
    PGHOST = os.getenv("PGHOST", "")
    PGPORT = os.getenv("PGPORT", "5432")
    PGDATABASE = os.getenv("PGDATABASE", "")
    PGUSER = os.getenv("PGUSER", "")
    PGPASSWORD = os.getenv("PGPASSWORD", "")
    PGSSLMODE = os.getenv("PGSSLMODE", "require")

    if PGHOST and PGDATABASE and PGUSER and PGPASSWORD:
        _pwd = quote_plus(PGPASSWORD)
        DATABASE_URL = (
            f"postgresql+asyncpg://{PGUSER}:{_pwd}@{PGHOST}:{PGPORT}/{PGDATABASE}"
            f"?sslmode={PGSSLMODE}"
        )
    else:
        DATABASE_URL = os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://hperkins:Twiohmld1234!@azure-chatapp-dbserver.postgres.database.azure.com:5432/azure_chatapp?sslmode=require",
        )

    # SSL settings for PostgreSQL connectivity
    PG_SSL_ALLOW_SELF_SIGNED: str = os.getenv("PG_SSL_ALLOW_SELF_SIGNED", "False")
    PG_SSL_ROOT_CERT: str = os.getenv("PG_SSL_ROOT_CERT", "")

    # JWT Configuration
    JWT_SECRET = os.getenv("JWT_SECRET", "insecure-debug-jwt-secret")
    JWT_ALGORITHM = "HS256"
    JWT_KEY_ID = os.getenv("JWT_KEY_ID", "debug-key-id")
    ACCESS_TOKEN_EXPIRE_MINUTES = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")
    )  # 1 day
    REFRESH_TOKEN_EXPIRE_DAYS = int(
        os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30")
    )  # 30 days

    # Cookie domain for the application
    COOKIE_DOMAIN: str = os.getenv("COOKIE_DOMAIN", "")  # Empty by default to use current host

    # Allowed hosts for development
    ALLOWED_HOSTS: list[str] = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "localhost:3000",  # Frontend port
        "localhost:8000",  # Backend port
    ]

    # CORS: Allow all origins for local development and debugging
    CORS_ORIGINS = ["*"]

    # --- Unified Model Configurations (unchanged or debug-friendly) ---

    # Azure / OpenAI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    AZURE_O1_MAX_IMAGES = int(os.getenv("AZURE_O1_MAX_IMAGES", "10"))
    AZURE_DEFAULT_API_VERSION = "2025-03-01-preview"
    AZURE_REASONING_API_VERSION = "2025-03-01-preview"

    AZURE_OPENAI_MODELS: dict[str, dict[str, Any]] = {
        "o1": {
            "provider": "azure",
            "type": "multimodal",
            "description": "Advanced vision model with reasoning capabilities",
            "capabilities": [
                "vision",
                "structured_output",
                "image_analysis",
                "reasoning_effort",
                "developer_messages",
            ],
            "parameters": {
                "vision_detail": ["low", "high"],
                "reasoning_effort": ["low", "medium", "high"],
            },
            "max_context_tokens": 200000,
            "max_completion_tokens": 100000,
            "max_images": AZURE_O1_MAX_IMAGES,
            "api_version": AZURE_REASONING_API_VERSION,
            "unsupported_params": [
                "temperature",
                "top_p",
                "presence_penalty",
                "frequency_penalty",
                "logprobs",
                "top_logprobs",
                "logit_bias",
                "max_tokens",
            ],
        },
        "o3-mini": {
            "provider": "azure",
            "type": "text",
            "description": "Specialized text reasoning model",
            "capabilities": [
                "reasoning_effort",
                "code_generation",
                "developer_messages",
                "streaming",
            ],
            "parameters": {
                "reasoning_effort": ["low", "medium", "high"],
            },
            "max_context_tokens": 200000,
            "max_completion_tokens": 100000,
            "api_version": AZURE_REASONING_API_VERSION,
            "unsupported_params": [
                "temperature",
                "top_p",
                "presence_penalty",
                "frequency_penalty",
                "logprobs",
                "top_logprobs",
                "logit_bias",
                "max_tokens",
            ],
        },
        "gpt-4o": {
            "provider": "azure",
            "type": "multimodal",
            "description": "Optimized vision with auto-detail",
            "capabilities": ["vision", "streaming", "functions"],
            "parameters": {
                "vision_detail": ["auto", "low", "high"],
            },
            "max_context_tokens": 128000,
            "max_tokens": 4096,
            "max_images": 10,
            "api_version": AZURE_DEFAULT_API_VERSION,
        },
        "gpt-4": {
            "provider": "azure",
            "type": "text",
            "description": "Highly capable text model",
            "capabilities": ["functions", "streaming"],
            "max_context_tokens": 8192,
            "max_tokens": 4096,
            "api_version": AZURE_DEFAULT_API_VERSION,
        },
        "gpt-35-turbo": {
            "provider": "azure",
            "type": "text",
            "description": "Fast text model",
            "capabilities": ["functions", "streaming"],
            "max_context_tokens": 4096,
            "max_tokens": 4096,
            "api_version": AZURE_DEFAULT_API_VERSION,
        },
    }

    AZURE_MAX_IMAGE_TOKENS = int(os.getenv("AZURE_MAX_IMAGE_TOKENS", "2000"))
    AZURE_VISION_DETAIL_LEVELS = {
        "low": 85,
        "high": 170,
        "auto": 128,
    }

    # Claude
    CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
    CLAUDE_API_VERSION = "2023-06-01"
    CLAUDE_BASE_URL = "https://api.anthropic.com/v1/messages"
    CLAUDE_EXTENDED_THINKING_ENABLED = (
        os.getenv("CLAUDE_EXTENDED_THINKING_ENABLED", "True").lower() == "true"
    )
    CLAUDE_EXTENDED_THINKING_BUDGET = int(
        os.getenv("CLAUDE_EXTENDED_THINKING_BUDGET", "16000")
    )

    CLAUDE_MODELS: dict[str, dict[str, Any]] = {
        "claude-3-opus-20240229": {
            "provider": "anthropic",
            "type": "text",
            "description": "Most powerful Claude model",
            "capabilities": ["extended_thinking"],
            "max_context_tokens": 200000,
            "max_tokens": 4096,
            "extended_thinking_config": {"min_budget": 1024, "default_budget": 8000},
            "streaming_threshold": 21333,
        },
        "claude-3-sonnet-20240229": {
            "provider": "anthropic",
            "type": "text",
            "description": "Balanced Claude model",
            "capabilities": [],
            "max_context_tokens": 200000,
            "max_tokens": 4096,
            "streaming_threshold": 21333,
        },
        "claude-3-haiku-20240307": {
            "provider": "anthropic",
            "type": "text",
            "description": "Fastest Claude model",
            "capabilities": [],
            "max_context_tokens": 200000,
            "max_tokens": 4096,
            "streaming_threshold": 21333,
        },
        "claude-3-7-sonnet-20250219": {
            "provider": "anthropic",
            "type": "multimodal",
            "description": "Latest Sonnet with Vision & Extended Thinking (Beta)",
            "capabilities": ["vision", "extended_thinking"],
            "max_context_tokens": 128000,
            "max_tokens": 4096,
            "extended_thinking_config": {"min_budget": 1024, "default_budget": 16000},
            "streaming_threshold": 21333,
            "beta_headers": {
                "anthropic-beta": "output-128k-2025-02-19",
                "anthropic-features": "extended-thinking-2025-02-19,long-context-2025-02-19",
            },
        },
    }

    # Embedding/Knowledge Base
    EMBEDDING_API = os.getenv("EMBEDDING_API", "")
    COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")

    # Migration control (if any)
    ALWAYS_APPLY_MIGRATIONS = (
        os.getenv("ALWAYS_APPLY_MIGRATIONS", "false").lower() == "true"
    )


# Instantiate insecure settings
settings = Settings()

__all__ = ["settings"]
