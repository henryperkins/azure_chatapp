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
    ALLOWED_HOSTS: list = Field(
        default=["put.photo", "www.put.photo", "localhost", "127.0.0.1", "*"],
        env="ALLOWED_HOSTS"
    )

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


settings = Settings()
