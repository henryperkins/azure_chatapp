-- Drop all tables in the correct order (handling dependencies)
DROP TABLE IF EXISTS artifacts CASCADE;
DROP TABLE IF EXISTS project_files CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS knowledge_bases CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS alembic_version CASCADE;

-- Ensure PostgreSQL extensions are available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tables in order of dependency

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP NULL
);

CREATE INDEX ix_users_username ON users(username);
CREATE INDEX ix_users_role ON users(role);

-- Knowledge bases table
CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    embedding_model VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_knowledge_bases_name ON knowledge_bases(name);

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    goals TEXT,
    description TEXT,
    token_usage INTEGER DEFAULT 0 NOT NULL,
    max_tokens INTEGER DEFAULT 200000 NOT NULL,
    custom_instructions TEXT,
    archived BOOLEAN DEFAULT FALSE NOT NULL,
    pinned BOOLEAN DEFAULT FALSE NOT NULL,
    is_default BOOLEAN DEFAULT FALSE NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE SET NULL,
    default_model VARCHAR(50) DEFAULT 'o1' NOT NULL,  -- This matches the model definition
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    extra_data JSONB,
    CONSTRAINT check_token_limit CHECK (max_tokens >= token_usage),
    CONSTRAINT check_archive_pin CHECK (NOT (archived AND pinned)), -- Archived projects cannot be pinned
    CONSTRAINT check_archive_default CHECK (NOT (archived AND is_default))
);
CREATE INDEX ix_projects_knowledge_base_id ON projects(knowledge_base_id);
CREATE INDEX ix_projects_user_id ON projects(user_id);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR DEFAULT 'New Chat' NOT NULL,
    model_id VARCHAR,
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
    message_count INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extra_data JSONB DEFAULT '{}'
);
CREATE INDEX ix_conversations_user_id ON conversations(user_id);
CREATE INDEX ix_conversations_project_id ON conversations(project_id);
CREATE INDEX ix_conversations_created_at ON conversations(created_at);
CREATE INDEX ix_conversations_is_deleted ON conversations(is_deleted);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR NOT NULL,
    content TEXT NOT NULL,
    extra_data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_messages_id ON messages(id);
CREATE INDEX ix_messages_conversation_id ON messages(conversation_id);
CREATE INDEX ix_messages_role ON messages(role);

-- Project Files table
CREATE TABLE project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    order_index INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content TEXT,
    extra_data JSONB
);
CREATE INDEX ix_project_files_project_id ON project_files(project_id);

-- Artifacts table
CREATE TABLE artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extra_data JSONB,
    CONSTRAINT valid_content_types CHECK (content_type IN ('code', 'document', 'image', 'audio', 'video'))
);
CREATE INDEX ix_artifacts_project_id ON artifacts(project_id);
