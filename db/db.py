"""
db.py
-----
Core database connection setup using SQLAlchemy.
Handles engine creation and session management.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
import ssl
import os
from urllib.parse import quote_plus

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
def _find_pg_ssl_cert():
    # Try environment variable first
    cert_env = getattr(settings, "PG_SSL_ROOT_CERT", None) or os.getenv("PG_SSL_ROOT_CERT")
    if cert_env and os.path.isfile(cert_env):
        return cert_env
    # Try common Azure CA cert names in project root
    candidates = [
        "BaltimoreCyberTrustRoot.crt.pem",
        "DigiCertGlobalRootG2.crt.pem",
        "DigiCertGlobalRootCA.crt.pem",
    ]
    for fname in candidates:
        if os.path.isfile(fname):
            return fname
    # Try static/certs/
    for fname in candidates:
        fpath = os.path.join("static", "certs", fname)
        if os.path.isfile(fpath):
            return fpath
    raise RuntimeError("No valid PostgreSQL CA root certificate found for SSL.")

if ALLOW_SELF_SIGNED:
    PG_SSL_CERT_PATH = None
    ssl_context = ssl._create_unverified_context()
    logger.warning("Using UNVERIFIED SSL context (self-signed allowed).")
else:
    PG_SSL_CERT_PATH = _find_pg_ssl_cert()
    logger.info(f"Using PostgreSQL SSL root certificate: {PG_SSL_CERT_PATH}")
    ssl_context = ssl.create_default_context(cafile=PG_SSL_CERT_PATH)

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
    # conexión cifrada pero sin validación de cadena
    sync_url = f"{base_sync_url}?sslmode=require"
else:
    # verificación completa + ruta explícita al certificado raíz
    sync_url = (
        f"{base_sync_url}"
        f"?sslmode=verify-full&sslrootcert={quote_plus(PG_SSL_CERT_PATH)}"
    )

sync_engine = create_engine(
    sync_url,
    pool_pre_ping=True
)

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
