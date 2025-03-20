-- Database schema validation and repair script
DO $$
DECLARE
    expected_table_count INTEGER := 7;  -- users, knowledge_bases, projects, conversations, messages, project_files, artifacts
    actual_table_count INTEGER;
BEGIN
    -- Get current table count
    SELECT COUNT(*) INTO actual_table_count 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE';

    -- Check table count matches
    IF actual_table_count != expected_table_count THEN
        RAISE NOTICE 'Database schema mismatch detected. Running reset script...';
        \i scripts/reset_db.sql
    ELSE
        RAISE NOTICE 'Database schema is up to date. No action needed.';
    END IF;
END $$;
