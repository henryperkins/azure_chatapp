# Python Models Developer Reference

This document provides a comprehensive overview of the SQLAlchemy models in this project.  
Use it for onboarding, maintenance, and as a reference for extending or debugging the data layer.

---

## Table of Contents

- [General Architecture](#general-architecture)
- [models/__init__.py](#models__init__py)
- [models/artifact.py](#modelsartifactpy)
- [models/conversation.py](#modelsconversationpy)
- [models/knowledge_base.py](#modelsknowledge_basepy)
- [models/message.py](#modelsmessagepy)
- [models/project.py](#modelsprojectpy)
- [models/project_file.py](#modelsproject_filepy)
- [models/user.py](#modelsuserpy)

---

## General Architecture

- **ORM:** All models use SQLAlchemy ORM with PostgreSQL dialects.
- **UUIDs:** Most primary keys are UUIDs for global uniqueness.
- **Timestamps:** All models track `created_at` and `updated_at`.
- **Relationships:** Foreign keys and relationships are used for all associations.
- **Constraints:** Data integrity is enforced with SQL and Python-level constraints.
- **Serialization:** Many models provide a `to_dict()` method for API serialization.
- **Enums:** Used for roles and content types where appropriate.
- **JSONB:** Used for flexible metadata and configuration storage.

---

## models/__init__.py

**Purpose:**  
Centralized import/export for all models.  
**Exports:**  
- `User`, `KnowledgeBase`, `Project`, `Conversation`, `Message`, `ProjectFile`, `Artifact`

---

## models/artifact.py

**Model:** `Artifact`

**Purpose:**  
Represents content generated within a project (code, documents, images, etc.).

**Fields:**
- `id` (UUID, PK)
- `project_id` (UUID, FK to Project)
- `conversation_id` (UUID, FK to Conversation, nullable)
- `name` (str)
- `content_type` (str: code, document, image, audio, video)
- `content` (str, up to 10MB)
- `created_at`, `updated_at` (datetime)
- `extra_data` (dict, JSONB, optional)

**Relationships:**
- `project` (many-to-one, Project)
- `conversation` (many-to-one, Conversation)

**Notes:**
- Enforces valid content types via SQL constraint.
- Provides `to_dict()` for serialization.

---

## models/conversation.py

**Model:** `Conversation`

**Purpose:**  
Represents a chat session, including metadata, user, project, and knowledge base association.

**Fields:**
- `id` (UUID, PK)
- `user_id` (int, FK to User)
- `project_id` (UUID, FK to Project, nullable)
- `title` (str)
- `model_id` (str, nullable)
- `is_deleted` (bool)
- `created_at`, `updated_at` (datetime)
- `extra_data` (dict, JSONB, optional)
- `knowledge_base_id` (UUID, FK to KnowledgeBase, nullable)
- `use_knowledge_base` (bool)
- `search_results` (dict, JSONB, optional)

**Relationships:**
- `user` (many-to-one, User)
- `knowledge_base` (many-to-one, KnowledgeBase)
- `messages` (one-to-many, Message)
- `project` (many-to-one, Project)
- `artifacts` (one-to-many, Artifact)

**Methods:**
- `validate_knowledge_base(db)`: Ensures KB is valid and indexed.
- `validate_kb_flag`: Ensures KB flag is consistent with project association.

**Notes:**
- Enforces that KB can only be used if project is set.
- Handles async validation of KB status and file indexing.

---

## models/knowledge_base.py

**Model:** `KnowledgeBase`

**Purpose:**  
Manages vector embeddings and semantic search for a project.

**Fields:**
- `id` (UUID, PK)
- `name` (str)
- `description` (str, optional)
- `embedding_model` (str, optional)
- `is_active` (bool)
- `version` (int)
- `last_used` (datetime, optional)
- `project_id` (UUID, FK to Project, unique, not nullable)
- `created_at`, `updated_at` (datetime)
- `config` (dict, JSONB)
- `repo_url`, `branch` (str, optional, for GitHub integration)
- `file_paths` (list[str], JSONB, optional)

**Relationships:**
- `project` (one-to-one, Project, back_populates)

**Notes:**
- Each project can have at most one knowledge base.
- Supports GitHub repo integration for KB source.

---

## models/message.py

**Model:** `Message`

**Purpose:**  
Stores messages in a conversation, including role, content, and metadata.

**Fields:**
- `id` (UUID, PK)
- `conversation_id` (UUID, FK to Conversation)
- `role` (str: user, assistant, system)
- `content` (str)
- `extra_data` (dict, JSONB, optional, validated by schema)
- `context_used` (dict, JSONB, optional)
- `created_at`, `updated_at` (datetime)

**Relationships:**
- `conversation` (many-to-one, Conversation)

**Methods:**
- `get_metadata_dict()`: Returns extra_data or empty dict.

**Notes:**
- Enforces valid roles via SQL constraint.
- Validates `extra_data` against a JSON schema on set.

---

## models/project.py

**Model:** `Project`

**Purpose:**  
Groups files, notes, and references for context in conversations.

**Fields:**
- `id` (UUID, PK)
- `name` (str)
- `goals`, `description` (str, optional)
- `token_usage`, `max_tokens` (int)
- `custom_instructions` (str, optional)
- `archived`, `pinned`, `is_default` (bool)
- `version` (int)
- `default_model` (str)
- `user_id` (int, FK to User)
- `created_at`, `updated_at` (datetime)
- `extra_data` (dict, JSONB, optional)

**Relationships:**
- `conversations` (one-to-many, Conversation)
- `artifacts` (one-to-many, Artifact)
- `files` (one-to-many, ProjectFile)
- `members` (many-to-many, ProjectUserAssociation)
- `knowledge_base` (one-to-one, KnowledgeBase)

**Methods:**
- `token_status`: Returns True if token usage is within max.

**Notes:**
- Enforces token usage, archive/pin, and archive/default constraints.
- Knowledge base relationship is one-to-one, owned by KnowledgeBase.

---

**Model:** `ProjectUserAssociation`

**Purpose:**  
Associates users with projects and tracks their role.

**Fields:**
- `project_id` (UUID, FK to Project, PK)
- `user_id` (int, FK to User, PK)
- `role` (str, default "member")
- `joined_at` (datetime)

**Relationships:**
- `project` (many-to-one, Project)
- `user` (many-to-one, User)

---

## models/project_file.py

**Model:** `ProjectFile`

**Purpose:**  
Stores files attached to a project.

**Fields:**
- `id` (UUID, PK)
- `project_id` (UUID, FK to Project)
- `file_hash` (str, optional, SHA-256)
- `filename` (str)
- `file_path` (str, up to 500 chars)
- `file_size` (int)
- `file_type` (str, e.g., pdf, docx, txt)
- `order_index` (int)
- `created_at`, `updated_at` (datetime)
- `content` (str, optional, inline content)
- `config` (dict, JSONB, optional, processed metadata)

**Relationships:**
- `project` (many-to-one, Project)

**Methods:**
- `to_dict()`: Returns a dictionary representation.

---

## models/user.py

**Model:** `User`

**Purpose:**  
Represents an authenticated user, with roles and preferences.

**Fields:**
- `id` (int, PK)
- `username` (str, unique)
- `password_hash` (str)
- `role` (str: user, admin)
- `created_at`, `updated_at` (datetime)
- `is_active`, `is_verified` (bool)
- `last_login`, `last_activity` (datetime)
- `token_version` (int)
- `preferences` (dict, JSONB)

**Relationships:**
- `conversations` (one-to-many, Conversation)
- `project_associations` (many-to-many, ProjectUserAssociation)

**Notes:**
- Enforces valid roles via SQL constraint.
- Tracks login and activity for security.

---

**Model:** `TokenBlacklist`

**Purpose:**  
Tracks revoked JWT tokens for security.

**Fields:**
- `id` (int, PK)
- `jti` (str, unique)
- `expires` (datetime)
- `user_id` (int, FK to User)
- `token_type` (str, default "access")
- `creation_reason` (str, optional)
- `created_at` (datetime)

---

## How to Add or Extend a Model

1. **Define a new class** inheriting from `Base` in the `models/` directory.
2. **Use mapped_column** for all fields, with types and constraints.
3. **Add relationships** for all foreign keys.
4. **Add constraints** for data integrity.
5. **Add `to_dict()` or serialization methods** if needed for API output.
6. **Document** with docstrings and update this reference as needed.

---

## Conclusion

This codebase is designed for modularity, data integrity, and maintainability.  
Always use SQL constraints, relationships, and clear serialization for all new models.

**For more details, see the docstrings and comments in each file.**  
If you need API details for a specific model, see the file or ask for that model’s API documentation.

---
