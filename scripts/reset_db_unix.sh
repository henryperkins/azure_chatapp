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
DB_NAME="azure_chat"  # Updated to correct database name

# Add connection test
if ! PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "postgres" -c "\q"; then
    echo "? Failed to connect to PostgreSQL server"
    exit 1
fi

# Create database if it doesn't exist
PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "postgres" \
    -c "CREATE DATABASE \"$DB_NAME\" WITH OWNER \"$DB_USER\";" 2>/dev/null

echo "Executing SQL script to reset database structure..."
PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" \
    -f scripts/reset_db.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "? DATABASE RESET SUCCESSFUL"
    echo "All tables have been recreated according to the model structure."
    
    # Simple verification
    echo -e "\nVerifying table counts..."
    PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" <<EOF
    SELECT 
        COUNT(*) as table_count,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM projects) as projects,
        (SELECT COUNT(*) FROM conversations) as conversations
    FROM information_schema.tables 
    WHERE table_schema = 'public';
EOF
else
    echo ""
    echo "? DATABASE RESET FAILED"
    echo "Check the error messages above."
    exit 1
fi
