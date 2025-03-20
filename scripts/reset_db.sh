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

# Get connection details from db.py
DB_URL=$(grep -E "DATABASE_URL\s*=" db.py | sed -E 's/.*"(.*)".*/\1/')
# Handle the asyncpg version - convert to standard psql URL
DB_URL=$(echo $DB_URL | sed 's/+asyncpg//')

# Simply use the full connection string with psql
echo "Executing SQL script to reset database structure..."
psql "$DB_URL" -f scripts/reset_db.sql

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
