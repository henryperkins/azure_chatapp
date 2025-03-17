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
    ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

    # Database
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./default.db")
    
    # JWT secret key
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "defaultsecret")

    # Azure OpenAI or OpenAI default keys
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")

settings = Settings()