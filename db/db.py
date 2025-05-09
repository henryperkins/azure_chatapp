"""
Database Utilities Module (`db.db`)
-----------------------------------

Provides unified, production-ready database connectivity using SQLAlchemy, with full support for both asynchronous (asyncpg) and synchronous (psycopg2) engines and sessions.

Features:
- Centralizes all DB connection and session creation logic to ensure consistency across app runtime and admin (DDL) operations.
- Robust SSL/TLS configuration: auto-detects CA bundles from common locations, supports strict verification as well as optional self-signed (development/debug) connectivity. Integration with certifi if present.
- Dynamically adapts connection parameters (URL, SSL certs, self-signed allowance) based on injected configuration/environment variables, designed for secure deployment on platforms like Azure Postgres.
- Exports FastAPI dependency-based session generators for async web request handling (`get_async_session`), as well as context managers for generalized usage.
- Sync SQLAlchemy engine/session setup for use in migrations, admin tasks, and schema management.
- Organizes SQLAlchemy `Base` for declarative model classes.

Environment/Config variables recognized:
- `settings.DATABASE_URL`
- `settings.PG_SSL_ALLOW_SELF_SIGNED` / `PG_SSL_ALLOW_SELF_SIGNED`
- `settings.PG_SSL_ROOT_CERT` / `PG_SSL_ROOT_CERT`

See code for entry points: `async_engine`, `sync_engine`, `AsyncSessionLocal`, `SessionLocal`, `Base`, `get_async_session`, `get_async_session_context`.

"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
import ssl
import os
from urllib.parse import quote_plus

# para usar el bundle de certifi cuando esté disponible
try:
    import certifi
except ImportError:  # certifi es opcional
    certifi = None

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

from config import settings


logger = logging.getLogger(__name__)

# Database URL from config
DATABASE_URL = settings.DATABASE_URL.split("?")[0]  # Remove any existing query parameters

# ---------------------------------------------------------
# Modalità self-signed / debug
# ---------------------------------------------------------
def _str_is_true(v: str | bool | None) -> bool:
    return str(v).lower() in ("1", "true", "yes")

ALLOW_SELF_SIGNED = (
    _str_is_true(os.getenv("PG_SSL_ALLOW_SELF_SIGNED"))
    or _str_is_true(getattr(settings, "PG_SSL_ALLOW_SELF_SIGNED", None))
)

# ---------------------------------------------------------
# SSL/TLS configuration
# ---------------------------------------------------------
def _find_pg_ssl_cert() -> str | None:
    """
    Devuelve la ruta a un bundle de CA válido o None si no se
    encuentra ninguno (se usará el almacén por defecto del sistema).
    """
    # 1) variable de entorno / settings
    cert_env = (
        getattr(settings, "PG_SSL_ROOT_CERT", None)
        or os.getenv("PG_SSL_ROOT_CERT")
    )
    if cert_env and os.path.isfile(cert_env):
        return cert_env

    # 2) candidatos locales comunes
    # Prioritize DigiCert G2 and Microsoft RSA as per Azure docs
    candidates = [
        "DigiCertGlobalRootG2.crt.pem",
        "MicrosoftRSARoot2017.pem",
        "DigiCertGlobalRootCA.pem", # Matches the .pem file we created
        "BaltimoreCyberTrustRoot.crt.pem", # Fallback
    ]
    for fname in candidates:
        if os.path.isfile(fname):
            return fname
        alt = os.path.join("static", "certs", fname)
        if os.path.isfile(alt):
            return alt

    # 3) bundle de certifi si existe
    if certifi:
        ca_path = certifi.where()
        if os.path.isfile(ca_path):
            return ca_path

    # 4) nada encontrado
    return None

if ALLOW_SELF_SIGNED:
    PG_SSL_CERT_PATH = None
    ssl_context = ssl._create_unverified_context()
    logger.warning("Using UNVERIFIED SSL context (self-signed allowed).")
else:
    PG_SSL_CERT_PATH = _find_pg_ssl_cert()
    ssl_context = ssl.create_default_context()
    if PG_SSL_CERT_PATH:
        ssl_context.load_verify_locations(cafile=PG_SSL_CERT_PATH)
        logger.info(f"Using PostgreSQL CA bundle: {PG_SSL_CERT_PATH}")
    else:
        logger.warning(
            "No explicit CA bundle found – falling back to system trust store."
        )

# ---------------------------------------------------------
# Async engine/session: for normal runtime usage
# ---------------------------------------------------------
async_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args={"ssl": ssl_context}  # Enable SSL for asyncpg
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    expire_on_commit=False
)

# ---------------------------------------------------------
# Sync engine/session: for DDL operations
# ---------------------------------------------------------
base_sync_url = DATABASE_URL.replace("+asyncpg", "").replace(
    "postgresql://", "postgresql+psycopg2://"
)

if ALLOW_SELF_SIGNED:
    sync_url = f"{base_sync_url}?sslmode=disable"
    sync_engine = create_engine(
        sync_url,
        connect_args={"sslmode": "disable"},
        pool_pre_ping=True
    )
elif PG_SSL_CERT_PATH:
    # Ensure the path is absolute for psycopg2 in the DSN
    abs_ssl_cert_path = os.path.abspath(PG_SSL_CERT_PATH)
    sync_url = (
        f"{base_sync_url}"
        f"?sslmode=verify-full"
        f"&sslrootcert={abs_ssl_cert_path}"
    )
    sync_engine = create_engine(sync_url, pool_pre_ping=True)
else:
    sync_url = f"{base_sync_url}?sslmode=require"
    sync_engine = create_engine(sync_url, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

# ---------------------------------------------------------
# Base for models
# ---------------------------------------------------------
Base = declarative_base()

# ---------------------------------------------------------
# Session management utilities
# ---------------------------------------------------------
async def get_async_session() -> AsyncGenerator:
    """FastAPI dependency for getting an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session

@asynccontextmanager
async def get_async_session_context():
    """Async context manager for database sessions."""
    session = AsyncSessionLocal()
    try:
        yield session
    finally:
        await session.close()
