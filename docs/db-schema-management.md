# Database Schema & ORM Management Guide

This document outlines how schema management, ORM operations, and database initialization work in this application. It describes the purpose of relevant modules, functions, and operational procedures for maintainers, developers, and DevOps integrators.

---

## Contents

- [Overview](#overview)
- [Key Files and Components](#key-files-and-components)
- [Engine & Session Utilities](#engine--session-utilities)
- [Schema Alignment & Validation](#schema-alignment--validation)
- [Migration & Alembic Integration](#migration--alembic-integration)
- [Application Startup, DB Init, and Health](#application-startup-db-init-and-health)
- [Best Practices & Automation](#best-practices--automation)
- [Relevant Environment Variables](#relevant-environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Overview

This application uses SQLAlchemy for ORM/database access and Alembic for migrations, with robust code for schema detection, creation, validation, and repair. Schema management is **automated** to keep the running database aligned with current ORM model definitions while supporting flexible migration workflows.

**Key goals:**
- Make DB initialization, migration, and schema drift correction transparent and robust.
- Protect destructive operations with explicit env flags.

---

## Key Files and Components

- **`config.py`**: Central configuration loader and runtime settings source. Supplies `DATABASE_URL`, migration toggles, SSL, and all environment-based config used by DB/ORM/code.
- **`db/db.py`**: Central entrypoint for all DB connectivity (sync and async engines, session factories, and base metadata).
- **`db/schema_manager.py`**: Logic for schema validation, drift detection, repair, and initialization. Handles both non-destructive and (optionally) destructive alignment operations.
- **`alembic/`**: Alembic migration scripts, config, and env.
- **`alembic/env.py`**: Bootstraps migration environment, contextually loads DB URL and model metadata for safe autogeneration.
- **`main.py`**: Application bootstrap—calls initialization during startup.

---

## Engine & Session Utilities

- **Async Engine/Session (Normal Runtime Usage):**
  - `async_engine`, `AsyncSessionLocal` (from `db/db.py`)
  - Use `get_async_session` or `get_async_session_context` as FastAPI dependencies or for CLI/services.
- **Sync Engine/Session (Migrations/DDL):**
  - `sync_engine`, `SessionLocal` (from `db/db.py`)
  - Used internally for sync (admin/migration) tasks.
- **Declarative Models:**
  - Inherit from `Base` (from `db/db.py`) to attach models to the main metadata.

#### Example (FastAPI endpoint dependency):

```python
from db.db import get_async_session

@app.get("/items/")
async def list_items(session: AsyncSession = Depends(get_async_session)):
    result = await session.execute(select(Item))
    return result.scalars().all()
```

---

## Schema Alignment & Validation

Managed in `db/schema_manager.py`, the `SchemaManager` can:

- **Initialize (create) any missing tables automatically** (correct dependency order).
- **Detect/validate drift**: Compare current DB state to ORM models, report discrepancies.
- **Repair drift**: Add missing columns/constraints/indexes. Optionally, drop or alter columns (protected by `AUTO_SCHEMA_DESTRUCTIVE` env).
- **Special handling**: Knows how to safely break model circular dependencies and patch up FKs after-the-fact.

#### Example Usage

```python
from db.schema_manager import SchemaManager

schema_manager = SchemaManager()

# Validate schema, see mismatches
issues = await schema_manager.validate_schema()

# Auto-align schema (safe: non-destructive unless flag set)
await schema_manager.fix_schema()

# Full DB (re)initialization (run on app startup)
await schema_manager.initialize_database()
```

---

## Migration & Alembic Integration

- **Migration scripts live in `alembic/` and are applied with standard Alembic CLI commands.**
- The `alembic/env.py` file injects the correct database URL and runtime model metadata.
- Automatic migration generation is supported (but usually controlled by build/deploy scripts). See `automated_alembic_migrate()` in `db/schema_manager.py`.
- **Typical dev workflow:**
  1. Edit or add SQLAlchemy models.
  2. Run: `alembic revision --autogenerate -m "desc"`
  3. Review/update generated migration as needed.
  4. Run: `alembic upgrade head`

**Note:** For full automation or CI/CD, `SchemaManager.initialize_database()` can also perform Alembic migration and alignment in code.

---

## Application Startup, DB Init, and Health

On app startup (see `main.py`):

- Database is initialized via `init_db()` (calls schema alignment/repair).
- If defaults are missing, test users/data are created as necessary.
- Health endpoint `/health` reports DB availability and app version.

---

## Best Practices & Automation

- Model all tables as subclasses of the declarative `Base` in `db/db.py`.
- Rely on automated runners (see `main.py` or management scripts) to:
  - Apply migrations.
  - Create and upgrade tables/indexes.
  - Repair (non-destructive) schema drift automatically.
- Use `AUTO_SCHEMA_DESTRUCTIVE=true` **only after a manual backup**.

---

## Relevant Environment Variables

| Variable                  | Description                                     | Typical Values     |
|---------------------------|-------------------------------------------------|--------------------|
| `DATABASE_URL`            | Connection string for DB                        | ...                |
| `PG_SSL_ALLOW_SELF_SIGNED`| Allow self-signed SSL certs for Postgres        | true/false         |
| `ENABLE_AUTO_MIGRATION`   | Enable auto-run Alembic migrate on startup      | true/false         |
| `AUTO_SCHEMA_DESTRUCTIVE` | Allow dropping or changing columns              | true/false         |
| `PG_SSL_ROOT_CERT`        | Path or pointer to SSL CA bundle for Postgres   | path/to/ca-bundle  |

---

## Troubleshooting

- If migrations fail: check DB logs and env var settings for SSL and connectivity.
- If tables are missing: ensure models are imported before running alignment/migration.
- If destructive operations are needed (drop, alter column): backup DB and set `AUTO_SCHEMA_DESTRUCTIVE=true`, then use `SchemaManager.fix_schema()`.

---

## Additional References

- [SQLAlchemy ORM documentation](https://docs.sqlalchemy.org/en/20/orm/)
- [Alembic migration documentation](https://alembic.sqlalchemy.org/)
