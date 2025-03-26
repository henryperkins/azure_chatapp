#!/bin/bash
# Direct database reset script - drops and recreates all tables based on model definitions

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "Error: psql command not found. Please install PostgreSQL client tools."
    exit 1
fi

# Check for auto-confirmation env var (useful for automation)
if [ -z "$USER_CONFIRMATION" ]; then
    echo "WARNING: This will DELETE ALL EXISTING DATA in the database!"
    echo "Are you sure you want to continue? (yes/no)"
    read confirmation
else
    confirmation="$USER_CONFIRMATION"
fi

if [ "$confirmation" != "yes" ]; then
    echo "Operation cancelled."
    exit 0
fi

# Use default PostgreSQL superuser credentials
DB_USER="postgres"
DB_PASS="postgres"  # Or your actual password if you've set one
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="azure_chat_db"  # Or your database name

# Build psql connection string
PSQL_CONN="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "Executing SQL script to reset database structure..."
psql "$PSQL_CONN" -f scripts/reset_db.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ DATABASE RESET SUCCESSFUL"
    echo "All tables have been recreated according to the model structure."
else
    echo ""
    echo "❌ DATABASE RESET FAILED"
    echo "Check the error messages above."
    exit 1
fi
