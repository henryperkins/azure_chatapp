-- Database schema validation and repair script
DO $$
DECLARE
    expected_tables TEXT[] := ARRAY[
        'users', 'knowledge_bases', 'projects', 
        'conversations', 'messages', 'project_files',
        'artifacts'
    ];
    missing_tables TEXT[];
    has_errors BOOLEAN := FALSE;
BEGIN
    -- Check for missing tables
    SELECT array_agg(table_name) INTO missing_tables
    FROM unnest(expected_tables) AS table_name
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = table_name
    );

    IF array_length(missing_tables, 1) > 0 THEN
        RAISE WARNING 'Missing tables: %', missing_tables;
        has_errors := TRUE;
    END IF;

    -- Check critical columns
    PERFORM 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'message_count';
    
    IF NOT FOUND THEN
        RAISE WARNING 'Missing message_count column in conversations table';
        has_errors := TRUE;
    END IF;

    -- Check projects.default_model default
    PERFORM 1 FROM information_schema.columns 
    WHERE table_name = 'projects' 
      AND column_name = 'default_model'
      AND column_default LIKE '%claude-3-sonnet%';
    
    IF NOT FOUND THEN
        RAISE WARNING 'Incorrect default_model default in projects table';
        has_errors := TRUE;
    END IF;

    IF has_errors THEN
        RAISE EXCEPTION 'Database schema validation failed - run reset_db.sql to repair';
    ELSE
        RAISE NOTICE '✅ Database schema is valid';
    END IF;
END $$;
