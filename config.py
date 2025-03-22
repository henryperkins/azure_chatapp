import os
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)


class Settings:
    """
    Central configuration class for environment variables used across the codebase.
    Values are loaded from environment or .env.
    """

    # Environment
    ENV = os.getenv("ENV", "development")

    # Session
    SESSION_SECRET = os.getenv(
        "SESSION_SECRET", "default-secret-key-change-in-production"
    )

    # Allowed hosts
    ALLOWED_HOSTS: list = os.getenv(
        "ALLOWED_HOSTS",
        "put.photo,www.put.photo,localhost,127.0.0.1,*"
    ).split(",")

    # CORS Origins - if left empty, default to localhost origins in development
    CORS_ORIGINS = (
        os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
    )

    # Database
    # Auth token expiration time in minutes
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/azure_chat_db",
    )

    # JWT secret key - must match JWT_SECRET in auth_deps.py
    JWT_SECRET = os.getenv("JWT_SECRET", "")

    # Azure OpenAI or OpenAI default keys
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")

    # Cookie domain
    COOKIE_DOMAIN: str = os.getenv("COOKIE_DOMAIN", "")

    # Claude configuration
    CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
    CLAUDE_API_VERSION = "2023-06-01"  # Current stable version
    CLAUDE_MODELS = ["claude-3-sonnet-20240229", "claude-3-haiku-20240307", "claude-3-opus-20240229", "claude-3-7-sonnet-20250219"]
    CLAUDE_BASE_URL = "https://api.anthropic.com/v1/messages"
    CLAUDE_EXTENDED_THINKING_ENABLED = os.getenv("CLAUDE_EXTENDED_THINKING_ENABLED", "True").lower() == "true"
    CLAUDE_EXTENDED_THINKING_BUDGET = int(os.getenv("CLAUDE_EXTENDED_THINKING_BUDGET", "16000"))


settings = Settings()
