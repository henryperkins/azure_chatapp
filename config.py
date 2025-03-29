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
    SESSION_SECRET = os.getenv("SESSION_SECRET", "default-secret-key-change-in-production")

    # Allowed hosts
    ALLOWED_HOSTS: list = os.getenv(
        "ALLOWED_HOSTS",
        "put.photo,www.put.photo,localhost,127.0.0.1,*"
    ).split(",")

    # CORS Origins
    CORS_ORIGINS = (
        os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
    )

    # Database
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/azure_chat_db",
    )
    # Format: postgresql+asyncpg://username:password@host:port/dbname

    JWT_SECRET = os.getenv("JWT_SECRET", "")

    # Azure/OpenAI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")

    # JWT Configuration
    JWT_SECRET = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM = "HS256"
    JWT_KEY_ID = os.getenv("JWT_KEY_ID", "default-key-id")  # For key rotation support
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

    # Cookie domain
    COOKIE_DOMAIN: str = os.getenv("COOKIE_DOMAIN", "")

    # Claude
    CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
    CLAUDE_API_VERSION = "2023-06-01"
    CLAUDE_MODELS = [
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
        "claude-3-opus-20240229",
        "claude-3-7-sonnet-20250219",
    ]
    CLAUDE_BASE_URL = "https://api.anthropic.com/v1/messages"
    CLAUDE_EXTENDED_THINKING_ENABLED = os.getenv("CLAUDE_EXTENDED_THINKING_ENABLED", "True").lower() == "true"
    CLAUDE_EXTENDED_THINKING_BUDGET = int(os.getenv("CLAUDE_EXTENDED_THINKING_BUDGET", "16000"))

    # ===== Add the lines below to define EMBEDDING_API and COHERE_API_KEY =====
    EMBEDDING_API = os.getenv("EMBEDDING_API", "")
    COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")

    # Migration control
    ALWAYS_APPLY_MIGRATIONS = os.getenv("ALWAYS_APPLY_MIGRATIONS", "false").lower() == "true"

settings = Settings()
