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
        "ALLOWED_HOSTS", "put.photo,www.put.photo,localhost,127.0.0.1,*"
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
    AZURE_O1_MAX_IMAGES = int(os.getenv("AZURE_O1_MAX_IMAGES", "10"))
    # Azure OpenAI Models Configuration
    AZURE_OPENAI_MODELS = {
        "o1": {
            "type": "multimodal",
            "description": "Advanced vision model with reasoning capabilities",
            "capabilities": ["vision", "structured_output", "image_analysis"],
            "vision_details": ["low", "high"],
            "max_tokens": 128000,
            "max_images": 10,
            "requires": ["vision_detail"],
            "api_version": "2024-05-01-preview"
        },
        "o3-mini": {
            "type": "text", 
            "description": "Specialized reasoning model",
            "capabilities": ["reasoning_effort", "code_generation"],
            "max_tokens": 16385,
            "requires": ["reasoning_effort"],
            "supports_system_msg": False
        },
        "gpt-4o": {
            "type": "multimodal",
            "description": "Optimized vision with auto-detail",
            "capabilities": ["vision", "streaming", "auto_detail"],
            "vision_details": ["auto", "low", "high"],
            "max_tokens": 128000,
            "api_version": "2024-05-01-preview"
        }
    }

    # Azure-specific vision configuration
    AZURE_MAX_IMAGE_TOKENS = int(os.getenv("AZURE_MAX_IMAGE_TOKENS", "2000"))
    AZURE_MAX_VISION_DETAIL_TOKENS = int(os.getenv("AZURE_MAX_VISION_DETAIL_TOKENS", "1000"))
    AZURE_VISION_DETAIL_LEVELS = {
        "low": 65,
        "high": 1295,
        "auto": 100  # Average estimate
    }

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
    CLAUDE_EXTENDED_THINKING_ENABLED = (
        os.getenv("CLAUDE_EXTENDED_THINKING_ENABLED", "True").lower() == "true"
    )
    CLAUDE_EXTENDED_THINKING_BUDGET = int(
        os.getenv("CLAUDE_EXTENDED_THINKING_BUDGET", "16000")
    )

    # ===== Add the lines below to define EMBEDDING_API and COHERE_API_KEY =====
    EMBEDDING_API = os.getenv("EMBEDDING_API", "")
    COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")

    # Migration control
    ALWAYS_APPLY_MIGRATIONS = (
        os.getenv("ALWAYS_APPLY_MIGRATIONS", "false").lower() == "true"
    )


settings = Settings()
