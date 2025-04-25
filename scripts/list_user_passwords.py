from sqlalchemy import create_engine, text
from config import settings

# Swap to psycopg2 for sync queries
DATABASE_URL = settings.DATABASE_URL.replace("asyncpg", "psycopg2")

engine = create_engine(DATABASE_URL)
with engine.connect() as conn:
    result = conn.execute(
        text("SELECT username, password_hash FROM users")
    )
    print("users table (username, password_hash):")
    for row in result:
        print(f"  {row.username}: {row.password_hash}")
