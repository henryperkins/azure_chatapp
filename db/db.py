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

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

from config import settings


logger = logging.getLogger(__name__)

# Database URL from config
DATABASE_URL = settings.DATABASE_URL.split("?")[0]  # Remove any existing query parameters

# ---------------------------------------------------------
# SSL/TLS configuration for Azure PostgreSQL
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

PG_SSL_CERT_PATH = _find_pg_ssl_cert()
logger.info(f"Using PostgreSQL SSL root certificate: {PG_SSL_CERT_PATH}")

# Allow override for self-signed/dev mode
ALLOW_SELF_SIGNED = (
    getattr(settings, "PG_SSL_ALLOW_SELF_SIGNED", None)
    or os.getenv("PG_SSL_ALLOW_SELF_SIGNED", "0")
) in ("1", "true", "True")

if ALLOW_SELF_SIGNED:
    ssl_context = ssl._create_unverified_context()
    logger.warning("PG_SSL_ALLOW_SELF_SIGNED is set: using unverified SSL context for asyncpg (INSECURE, DEV ONLY).")
else:
    try:
        ssl_context = ssl.create_default_context(cafile=PG_SSL_CERT_PATH)
    except Exception as e:
        logger.error(f"Failed to create SSL context with CA file {PG_SSL_CERT_PATH}: {e}")
        raise

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
sync_url = DATABASE_URL.replace("+asyncpg", "")
sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://")  # Explicit psycopg2 driver
# For psycopg2, use sslmode and sslrootcert
sync_url += f"?sslmode=verify-full&sslrootcert={PG_SSL_CERT_PATH}"
sync_engine = None
try:
    sync_engine = create_engine(
        sync_url,
        pool_pre_ping=True
    )
except Exception as e:
    logger.error(f"Failed to create sync engine with CA file {PG_SSL_CERT_PATH}: {e}")
    # Fallback: Insecure for dev only
    fallback_url = sync_url.replace("sslmode=verify-full", "sslmode=require")
    sync_engine = create_engine(
        fallback_url,
        pool_pre_ping=True
    )
    logger.warning("Falling back to sslmode=require (no cert validation) for psycopg2 sync engine.")

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
