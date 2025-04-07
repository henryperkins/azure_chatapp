# MODIFIED: config.py
# Reason: Consolidate model configurations, add capabilities based on docs, standardize structure.

import os
from dotenv import load_dotenv
from pathlib import Path
import uuid

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)


class Settings:
    """
    Central configuration class for environment variables used across the codebase.
    Values are loaded from environment or .env.
    """

    # Debug/Environment
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"  # True if DEBUG= true/TRUE/True
    ENV = os.getenv("ENV", "development")

    # Session
    SESSION_SECRET = os.getenv(
        "SESSION_SECRET", "default-secret-key-change-in-production"
    )


    # Database
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/azure_chat_db",
    )
    # Format: postgresql+asyncpg://username:password@host:port/dbname

    # JWT Configuration
    JWT_SECRET = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM = "HS256"
    JWT_KEY_ID = os.getenv("JWT_KEY_ID", "default-key-id")  # For key rotation support
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

    # Cookie domain (disabled for CORS testing)
    COOKIE_DOMAIN: str = ""

    # --- Unified Model Configurations ---

    # Azure/OpenAI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")  # Standard OpenAI key if needed
    AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    AZURE_O1_MAX_IMAGES = int(
        os.getenv("AZURE_O1_MAX_IMAGES", "10")
    )  # Max images for o1
    AZURE_DEFAULT_API_VERSION = "2024-05-01-preview"  # Default for non-reasoning
    AZURE_REASONING_API_VERSION = (
        "2025-03-01-preview"  # Recommended for reasoning models
    )

    AZURE_OPENAI_MODELS = {
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
            "max_context_tokens": 200000,  # Input context window
            "max_completion_tokens": 100000,  # Max output tokens for the model itself
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
            ],  # Params NOT to send
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
            "max_context_tokens": 200000,  # Input context window
            "max_completion_tokens": 100000,  # Max output tokens for the model itself
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
            ],  # Params NOT to send
        },
        "gpt-4o": {
            "provider": "azure",
            "type": "multimodal",
            "description": "Optimized vision with auto-detail",
            "capabilities": ["vision", "streaming", "functions"],
            "parameters": {
                "vision_detail": ["auto", "low", "high"],
            },
            "max_context_tokens": 128000,  # Total token limit (input + output)
            "max_tokens": 4096,  # Default completion limit, can be overridden up to context limit minus prompt
            "max_images": 10,
            "api_version": AZURE_DEFAULT_API_VERSION,
        },
        # Add other Azure models like gpt-4, gpt-3.5-turbo if used
        "gpt-4": {
            "provider": "azure",
            "type": "text",
            "description": "Highly capable text model",
            "capabilities": ["functions", "streaming"],
            "max_context_tokens": 8192,
            "max_tokens": 4096,
            "api_version": AZURE_DEFAULT_API_VERSION,
        },
        "gpt-35-turbo": {  # Match deployment name used in gpt4completions.md example
            "provider": "azure",
            "type": "text",
            "description": "Fast text model",
            "capabilities": ["functions", "streaming"],
            "max_context_tokens": 4096,  # Or 16k depending on deployment
            "max_tokens": 4096,
            "api_version": AZURE_DEFAULT_API_VERSION,
        },
    }

    # Azure-specific vision configuration
    AZURE_MAX_IMAGE_TOKENS = int(
        os.getenv("AZURE_MAX_IMAGE_TOKENS", "2000")
    )  # Generic token cost estimate per image
    AZURE_VISION_DETAIL_LEVELS = {  # Token cost per image based on detail (from docs)
        "low": 85,  # Typically 85 tokens
        "high": 170,  # Can be more with multiple tiles, but base cost is 2*low
        "auto": 128,  # Estimate, depends on model decision
    }

    # Claude
    CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
    CLAUDE_API_VERSION = "2023-06-01"  # API version for headers
    CLAUDE_BASE_URL = "https://api.anthropic.com/v1/messages"
    CLAUDE_EXTENDED_THINKING_ENABLED = (
        os.getenv("CLAUDE_EXTENDED_THINKING_ENABLED", "True").lower() == "true"
    )
    CLAUDE_EXTENDED_THINKING_BUDGET = int(
        os.getenv("CLAUDE_EXTENDED_THINKING_BUDGET", "16000")
    )

    CLAUDE_MODELS = {
        "claude-3-opus-20240229": {
            "provider": "anthropic",
            "type": "text",
            "description": "Most powerful Claude model",
            "capabilities": ["extended_thinking"],
            "max_context_tokens": 200000,
            "max_tokens": 4096,  # Default API limit unless specified higher
            "extended_thinking_config": {"min_budget": 1024, "default_budget": 8000},
            "streaming_threshold": 21333,  # Max tokens requiring streaming
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
            "max_context_tokens": 128000,  # Specific context limit for this beta model
            "max_tokens": 4096,  # Default API limit
            "extended_thinking_config": {"min_budget": 1024, "default_budget": 16000},
            "streaming_threshold": 21333,
            "beta_headers": {  # Headers for beta features
                "anthropic-beta": "output-128k-2025-02-19",
                "anthropic-features": "extended-thinking-2025-02-19,long-context-2025-02-19",
            },
        },
    }

    # Embedding/Knowledge Base
    EMBEDDING_API = os.getenv(
        "EMBEDDING_API", ""
    )  # Could be Cohere, Azure, OpenAI etc.
    COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")  # Example if using Cohere

    # Migration control
    ALWAYS_APPLY_MIGRATIONS = (
        os.getenv("ALWAYS_APPLY_MIGRATIONS", "false").lower() == "true"
    )


settings = Settings()
