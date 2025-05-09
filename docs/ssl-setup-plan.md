# SSL Certificate Setup for Alembic & SQLAlchemy

1. Verify that /home/azureuser/.postgresql/root.crt exists and is readable by the appropriate user/process.
2. Set the environment variable:
   PG_SSL_ROOT_CERT=/home/azureuser/.postgresql/root.crt
3. Ensure PG_SSL_ALLOW_SELF_SIGNED=false (unless self-signed is intentionally used).
4. Update your Alembic or SQLAlchemy connection string to use sslmode=verify-full and reference the root.crt path. For asyncpg, it will rely on the ssl_context from PG_SSL_ROOT_CERT.
5. Test with:
   alembic upgrade head
6. Store these settings in .env or the deployment environment so they apply consistently across environments.
