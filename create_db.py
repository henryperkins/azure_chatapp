import psycopg2
from psycopg2 import sql
import os

# Database connection parameters
DB_HOST = "localhost"
DB_USER = "postgres"
DB_PASS = "new_password"
DB_NAME = "azure_chat"

def create_database():
    # Connect to postgres database to create our database
    conn = psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        dbname="postgres"
    )
    conn.autocommit = True
    cur = conn.cursor()
    
    # Check if database exists
    cur.execute(sql.SQL("SELECT 1 FROM pg_database WHERE datname = %s"), [DB_NAME])
    exists = cur.fetchone()
    
    if not exists:
        print(f"Creating database {DB_NAME}...")
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DB_NAME)))
    else:
        print(f"Database {DB_NAME} already exists")
    
    cur.close()
    conn.close()

def execute_sql_script():
    # Read the SQL script
    with open("scripts/reset_db.sql", "r") as f:
        sql_script = f.read()
    
    # Connect to our database
    conn = psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME
    )
    conn.autocommit = True
    cur = conn.cursor()
    
    # Split into individual statements and execute
    statements = sql_script.split(';')
    for statement in statements:
        if statement.strip():
            try:
                cur.execute(statement)
            except Exception as e:
                print(f"Error executing statement: {e}")
                print(f"Statement: {statement[:100]}...")  # Print first 100 chars
    
    cur.close()
    conn.close()
    print("Database schema initialized successfully")

if __name__ == "__main__":
    create_database()
    execute_sql_script()