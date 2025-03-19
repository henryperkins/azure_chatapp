# Database Reset Documentation

This document explains how to reset your database to match the current SQLAlchemy model structure.

## What This Does

The database reset process will:

1. Drop all existing tables in the database
2. Recreate tables based on the current SQLAlchemy model definitions
3. Set up all necessary constraints, indexes, and relationships

**WARNING: This process will delete all data in the database. Only use this when you don't need to preserve existing data.**

## Why Reset the Database

You might want to reset your database in these scenarios:

- Your database schema has drifted from your model definitions
- You've made significant changes to your models and want a clean slate
- You're setting up a development environment and need a fresh database

## How to Reset the Database

### Method 1: Using the Reset Script (Recommended)

We've created a convenient script that handles the reset process:

```bash
# From the project root
python scripts/reset_database.py
```

The script will:
- Ask for confirmation before proceeding
- Run the migration that resets the database structure
- Provide feedback on the process

### Method 2: Using Alembic Directly

If you prefer, you can use Alembic directly:

```bash
# From the project root
alembic upgrade head
```

This will apply all migrations, including the new reset migration.

## How It Works

The reset process uses a special Alembic migration (`20250320_reset_database_structure.py`) that:

1. Drops all existing tables in the correct order (respecting foreign key constraints)
2. Creates the necessary PostgreSQL extensions (like uuid-ossp)
3. Recreates all tables with the correct structure as defined in the models

## Database Schema

After resetting, your database will contain these tables:

- `users` - User accounts and authentication
- `knowledge_bases` - Vector embeddings and semantic search capabilities
- `projects` - Groups files, notes, and references
- `conversations` - Chat conversations with metadata
- `messages` - Individual messages in conversations
- `project_files` - Files attached to projects
- `artifacts` - Generated content within projects (code, documents, etc.)

All tables include timestamps (`created_at`, `updated_at`) and appropriate indexes for performance.