from sqlalchemy import create_engine, text
from config import settings

# Swap to psycopg2 for sync queries
DATABASE_URL = settings.DATABASE_URL.replace("asyncpg", "psycopg2")

engine = create_engine(DATABASE_URL)
with engine.connect() as conn:
    result = conn.execute(
        text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'")
    )
    print("users table columns:")
    for row in result:
        print(f"  {row.column_name}: {row.data_type}")
