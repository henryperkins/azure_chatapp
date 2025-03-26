-- Add missing indexes to users table to match ORM model
CREATE INDEX IF NOT EXISTS ix_users_id ON users(id);
CREATE INDEX IF NOT EXISTS ix_users_last_login ON users(last_login);
CREATE INDEX IF NOT EXISTS ix_users_created_at ON users(created_at);

-- Verify indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'users';
